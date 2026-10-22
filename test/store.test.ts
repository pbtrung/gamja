import { describe, expect, it, vi } from "vitest";
import { BufferStore, Item } from "../src/store";
import { Unread } from "../src/state";

describe("Item", () => {
	it("loads and stores JSON", () => {
		const item = new Item<{ a: number }>("test");
		expect(item.load()).toBeNull();
		item.put({ a: 1 });
		expect(localStorage.getItem("gamja_test")).toBe('{"a":1}');
		expect(item.load()).toEqual({ a: 1 });
		item.put(null);
		expect(localStorage.getItem("gamja_test")).toBeNull();
	});

	it("survives corrupted data", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		localStorage.setItem("gamja_bad", "{nope");
		expect(new Item("bad").load()).toBeNull();
	});
});

describe("BufferStore", () => {
	const server = { bouncerNetwork: "1" };

	it("merges updates and keeps the newest receipts", () => {
		vi.useFakeTimers();
		const store = new BufferStore();
		expect(store.put({ name: "#c", server, unread: Unread.MESSAGE })).toBe(true);
		expect(store.put({ name: "#C", server, unread: Unread.MESSAGE })).toBe(false);
		expect(store.put({ name: "#c", server, receipts: { read: { time: "2020-01-02" } } })).toBe(true);
		expect(store.put({ name: "#c", server, receipts: { read: { time: "2020-01-01" } } })).toBe(false);
		const stored = store.get({ name: "#c", server })!;
		expect(stored.unread).toBe(Unread.MESSAGE);
		// A read receipt implies delivery
		expect(stored.receipts).toEqual({ read: { time: "2020-01-02" }, delivered: { time: "2020-01-02" } });
		expect(store.put({ name: "#c", server, closed: true })).toBe(true);

		vi.advanceTimersByTime(500);
		expect(JSON.parse(localStorage.getItem("gamja_buffers")!)).toHaveProperty(
			store.key({ name: "#c", server }),
		);

		const reloaded = new BufferStore();
		expect(reloaded.get({ name: "#c", server })?.closed).toBe(true);
	});

	it("lists and clears per server", () => {
		const store = new BufferStore();
		store.put({ name: "#a", server });
		store.put({ name: "#b", server: { bouncerNetwork: "2" } });
		store.put({ name: "#c", server: {} });
		expect(store.list(server).map((b) => b.name)).toEqual(["#a"]);
		expect(store.list({ bouncerNetwork: null }).map((b) => b.name)).toEqual(["#c"]);
		store.clear(server);
		expect(store.list(server)).toEqual([]);
		expect(store.m.size).toBe(2);
		store.delete({ name: "#c", server: {} });
		expect(store.m.size).toBe(1);
		store.clear();
		expect(store.m.size).toBe(0);
	});

	it("saves immediately when the page is hidden", () => {
		const store = new BufferStore();
		store.put({ name: "#a", server });
		Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
		document.dispatchEvent(new Event("visibilitychange"));
		expect(localStorage.getItem("gamja_buffers")).not.toBeNull();
		Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
	});

	it("stops listening to the page visibility once disposed", () => {
		const store = new BufferStore();
		store.dispose();
		store.put({ name: "#disposed", server });
		Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
		document.dispatchEvent(new Event("visibilitychange"));
		// Stores of the previous tests are still listening
		expect(localStorage.getItem("gamja_buffers") ?? "").not.toContain("#disposed");
		Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
	});
});

describe("BufferStore keys", () => {
	it("gives the same key to a missing and a null bouncer network", () => {
		const store = new BufferStore();
		expect(store.key({ name: "#c", server: {} })).toBe(
			store.key({ name: "#c", server: { bouncerNetwork: null } }),
		);
		store.put({ name: "#c", server: {}, unread: Unread.MESSAGE });
		expect(store.get({ name: "#c", server: { bouncerNetwork: null } })?.unread).toBe(Unread.MESSAGE);
		store.clear();
	});

	it("merges copies stored under different keys, and drops corrupted ones", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		localStorage.setItem(
			"gamja_buffers",
			JSON.stringify({
				a: {
					name: "#c",
					server: {},
					unread: "",
					receipts: { read: { time: "2020-01-01" } },
					closed: true,
				},
				b: {
					name: "#c",
					server: { bouncerNetwork: null },
					unread: "message",
					receipts: { read: { time: "2020-01-02" } },
					closed: false,
				},
				c: "junk",
				d: { name: 1, server: {} },
			}),
		);
		const store = new BufferStore();
		expect(store.m.size).toBe(1);
		expect(store.get({ name: "#c", server: {} })).toEqual({
			name: "#c",
			unread: Unread.MESSAGE,
			receipts: { read: { time: "2020-01-02" } },
			closed: false,
			server: { bouncerNetwork: null },
		});
		store.clear();
	});
});

describe("settings", () => {
	it("loads only valid settings", async () => {
		const { settings } = await import("../src/store");
		localStorage.setItem("gamja_settings", JSON.stringify({ layout: "bubbles", nickAlign: 3 }));
		expect(settings.load()).toEqual({ layout: "bubbles" });
		localStorage.removeItem("gamja_settings");
		expect(settings.load()).toBeNull();
	});
});
