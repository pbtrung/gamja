import { describe, expect, it, vi } from "vitest";
import { BufferStore, Item } from "../src/store";
import { CaseMapping } from "../src/lib/irc";
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
			server: { url: null, bouncerNetwork: null },
		});
		store.clear();
	});

	it("keeps the buffers of different servers apart", () => {
		const store = new BufferStore();
		const a = { url: "wss://a.example/", bouncerNetwork: "1" };
		const b = { url: "wss://b.example/", bouncerNetwork: "1" };
		store.put({ name: "#private", server: a, unread: Unread.MESSAGE });
		expect(store.get({ name: "#private", server: b })).toBeUndefined();
		expect(store.list(b)).toEqual([]);
		expect(store.list(a).map((buf) => buf.name)).toEqual(["#private"]);
		store.clear(b);
		expect(store.list(a)).toHaveLength(1);
		store.clear();
	});

	it("gives buffers stored without a server URL to the first server listing them", () => {
		localStorage.setItem(
			"gamja_buffers",
			JSON.stringify({ k: { name: "#c", server: {}, unread: "message", receipts: {}, closed: false } }),
		);
		const store = new BufferStore();
		const a = { url: "wss://a.example/" };
		expect(store.list(a).map((buf) => [buf.name, buf.server.url])).toEqual([["#c", "wss://a.example/"]]);
		expect(store.list({ url: "wss://b.example/" })).toEqual([]);
		expect(store.get({ name: "#c", server: a })?.unread).toBe(Unread.MESSAGE);
		store.clear();
	});

	it("looks names up with the server's case-mapping", () => {
		const store = new BufferStore();
		const rfc1459 = { url: "wss://a.example/", cm: CaseMapping.RFC1459 };
		store.put({ name: "#[private]", server: rfc1459, receipts: { read: { time: "2020-01-01" } } });
		expect(store.get({ name: "#{PRIVATE}", server: rfc1459 })?.receipts.read).toEqual({
			time: "2020-01-01",
		});

		const ascii = { url: "wss://b.example/", cm: CaseMapping.ASCII };
		store.put({ name: "#[a]", server: ascii, unread: Unread.MESSAGE });
		expect(store.get({ name: "#{a}", server: ascii })).toBeUndefined();
		// Not folded by ASCII case-mappings
		store.put({ name: "#Ä", server: ascii, unread: Unread.MESSAGE });
		expect(store.get({ name: "#ä", server: ascii })).toBeUndefined();
		store.clear();
	});

	it("merges copies of a buffer equal per the case-mapping", () => {
		const store = new BufferStore();
		const ascii = { url: "wss://a.example/", cm: CaseMapping.ASCII };
		store.put({ name: "#[a]", server: ascii, receipts: { read: { time: "2020-01-01" } } });
		store.put({ name: "#{a}", server: ascii, receipts: { read: { time: "2020-01-02" } } });
		const rfc1459 = { ...ascii, cm: CaseMapping.RFC1459 };
		expect(store.list(rfc1459)).toHaveLength(1);
		expect(store.get({ name: "#[a]", server: rfc1459 })?.receipts.read).toEqual({ time: "2020-01-02" });
		store.clear();
	});
});

describe("BufferStore in several tabs", () => {
	const server = { url: "wss://a.example/" };

	it("keeps the buffers saved by another tab", () => {
		const tab1 = new BufferStore();
		const tab2 = new BufferStore();
		tab1.put({ name: "#a", server });
		tab2.put({ name: "#b", server });
		tab1.saveImmediately();
		tab2.saveImmediately();
		const reloaded = new BufferStore();
		expect(
			reloaded
				.list(server)
				.map((buf) => buf.name)
				.sort(),
		).toEqual(["#a", "#b"]);
		[tab1, tab2, reloaded].forEach((s) => s.dispose());
	});

	it("keeps the newest receipts and deletions across tabs", () => {
		const tab1 = new BufferStore();
		tab1.put({ name: "#a", server, receipts: { read: { time: "2020-01-02" } } });
		tab1.put({ name: "#b", server });
		tab1.saveImmediately();
		const tab2 = new BufferStore();
		tab2.put({
			name: "#a",
			server,
			receipts: { read: { time: "2020-01-01" }, delivered: { time: "2020-01-03" } },
		});
		tab1.delete({ name: "#b", server });
		tab1.saveImmediately();
		tab2.saveImmediately();
		const reloaded = new BufferStore();
		expect(reloaded.list(server).map((buf) => buf.name)).toEqual(["#a"]);
		expect(reloaded.get({ name: "#a", server })?.receipts).toEqual({
			read: { time: "2020-01-02" },
			delivered: { time: "2020-01-03" },
		});
		[tab1, tab2, reloaded].forEach((s) => s.dispose());
	});

	it("follows the changes saved by other tabs", () => {
		const tab1 = new BufferStore();
		const tab2 = new BufferStore();
		tab2.put({ name: "#b", server });
		tab2.saveImmediately();
		window.dispatchEvent(new StorageEvent("storage", { key: "gamja_buffers" }));
		expect(tab1.get({ name: "#b", server })).toBeDefined();
		[tab1, tab2].forEach((s) => s.dispose());
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
