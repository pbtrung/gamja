import { describe, expect, it, vi } from "vitest";
import { Item, BufferStore } from "../src/store";
import * as irc from "../src/lib/irc";
import { connectedApp } from "./helpers/app";
import { ClientStatus } from "../src/lib/client";

describe("storage edge cases", () => {
	it.each([false, 0, ""])("round-trips the value %j", (value) => {
		const item = new Item<typeof value>("edge");
		item.put(value);
		expect(item.load()).toBe(value);
	});

	it("drops malformed receipts and server references from persisted buffers", () => {
		localStorage.setItem(
			"gamja_buffers",
			JSON.stringify({
				badServer: { name: "#bad", server: { url: 42 } },
				valid: {
					name: "#ok",
					server: {},
					receipts: {
						read: { time: "" },
						delivered: { time: 42 },
						unexpected: { time: "2020-01-01" },
					},
				},
			}),
		);
		const store = new BufferStore();
		try {
			expect(store.list({})).toHaveLength(1);
			expect(store.list({})[0].receipts).toEqual({});
		} finally {
			store.dispose();
		}
	});

	it("retains pending changes after a failed write so a later save can retry", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const store = new BufferStore();
		store.put({ name: "#retry", server: {} });
		const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
			throw new Error("Quota exceeded");
		});
		store.saveImmediately();
		expect(store.dirty.size).toBe(1);
		store.saveImmediately();
		expect(write).toHaveBeenCalledTimes(2);
		expect(localStorage.getItem("gamja_buffers")).toContain("#retry");
		store.dispose();
	});
});

describe("IRC wire edge cases", () => {
	it.each(["", "PRIVMSG #other", ":QUIT"])("rejects an invalid command %j", (command) => {
		expect(() => irc.formatMessage({ command })).toThrow();
	});

	it.each(["name", "user", "host"] as const)("rejects line injection through prefix %s", (field) => {
		expect(() =>
			irc.formatMessage({ command: "NOTICE", prefix: { name: "nick", [field]: "x\r\nQUIT" } }),
		).toThrow();
	});

	it("normalizes case-insensitive incoming commands", () => {
		expect(irc.parseMessage(":n privmsg #c :hello").command).toBe("PRIVMSG");
		expect(irc.parseMessage("ping").command).toBe("PING");
	});

	it("keeps prototype-named tags as ordinary own properties", () => {
		const tags = irc.parseTags("__proto__=value;constructor=other");
		expect(Object.hasOwn(tags, "__proto__")).toBe(true);
		expect(tags["__proto__"]).toBe("value");
		expect(irc.formatTags(tags)).toBe("__proto__=value;constructor=other");
	});
});

describe("controller and connection edge cases", () => {
	it("keeps the reply selected and reports synchronous send failures", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { app, serverID, recv } = await connectedApp();
		try {
			recv(":me!u@h JOIN #c");
			const id = app.createBuffer(serverID, "#c");
			app.setBufferState(id, { hasInitialWho: true });
			app.switchBuffer(id);
			const reply = { buffer: id, msgid: "m1", nick: "bob", text: "hi" };
			app.update({ replyTo: reply });
			vi.spyOn(app.clients.get(serverID)!, "send").mockImplementation(() => {
				throw new Error("Socket failed");
			});
			expect(app.handleComposerSubmit("hello")).toBe(false);
			expect(app.state.replyTo).toEqual(reply);
			expect(app.state.error).toBe("Socket failed");
		} finally {
			app.destroy();
		}
	});

	it("ignores invalid read marker timestamps", async () => {
		const { app, serverID, recv } = await connectedApp();
		try {
			recv(":srv MARKREAD bob timestamp=not-a-date");
			expect(
				app.bufferStore.get({ name: "bob", server: { url: app.clients.get(serverID)!.params.url } }),
			).toBeUndefined();
		} finally {
			app.destroy();
		}
	});

	it("accepts a one-parameter PONG for explicit pings and keepalive", async () => {
		const { app, serverID, recv, sent } = await connectedApp();
		const client = app.clients.get(serverID)!;
		vi.useFakeTimers();
		try {
			const ping = client.ping();
			const token = sent()
				.find((line) => line.startsWith("PING "))!
				.slice(5);
			recv(`:srv PONG ${token}`);
			await ping;
			client.scheduleLagCheck(1);
			vi.advanceTimersByTime(1);
			const lagToken = sent()
				.find((line) => line.startsWith("PING "))!
				.slice(5);
			vi.advanceTimersByTime(25);
			recv(`:srv PONG ${lagToken}`);
			expect(client.lag).toBe(25);
			vi.advanceTimersByTime(30_000);
			expect(client.status).toBe(ClientStatus.REGISTERED);
			expect(sent()).toContainEqual(expect.stringMatching(/^PING gamja-lag-/));
		} finally {
			app.destroy();
		}
	});
});

describe("asynchronous history boundaries", () => {
	it("does not resurrect a conversation closed while its backlog was loading", async () => {
		const { app, serverID } = await connectedApp();
		try {
			const id = app.createBuffer(serverID, "bob");
			const client = app.clients.get(serverID)!;
			const response = Promise.withResolvers<{ messages: irc.Message[]; more: boolean }>();
			vi.spyOn(client, "fetchHistoryPageBetween").mockReturnValue(response.promise);
			const loading = app.fetchTargetBacklog(serverID, client, "bob", {
				from: { time: "2024-01-01T00:00:00.000Z" },
				to: { time: "2024-01-03T00:00:00.000Z" },
			});
			app.close(id);
			response.resolve({
				messages: [irc.parseMessage("@time=2024-01-02T00:00:00.000Z :bob!u@h PRIVMSG me :late")],
				more: false,
			});
			await loading;
			expect([...app.state.buffers.values()].some((buf) => buf.name === "bob")).toBe(false);
		} finally {
			app.destroy();
		}
	});

	it("retains a failed deferred backlog for a later attempt", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { app, serverID } = await connectedApp();
		try {
			const id = app.createBuffer(serverID, "bob");
			const backlog = {
				from: { time: "2024-01-01T00:00:00.000Z" },
				to: { time: "2024-01-03T00:00:00.000Z" },
			};
			app.deferredBacklogs.set(id, backlog);
			vi.spyOn(app.clients.get(serverID)!, "fetchHistoryPageBetween").mockRejectedValue(
				new Error("Temporary failure"),
			);
			app.fetchDeferredBacklog(id);
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(app.deferredBacklogs.get(id)).toEqual(backlog);
			expect(app.loadingBacklogs.has(id)).toBe(false);
		} finally {
			app.destroy();
		}
	});

	it("serializes unlabeled searches and does not mix their result batches", async () => {
		const { app, serverID, recv, sent } = await connectedApp({
			caps: "batch server-time soju.im/search",
		});
		const client = app.clients.get(serverID)!;
		try {
			const first = client.search({ text: "first" });
			const second = client.search({ text: "second" });
			await Promise.resolve();
			expect(sent().filter((line) => line.startsWith("SEARCH "))).toHaveLength(1);
			recv(":srv BATCH +one soju.im/search", "@batch=one :bob PRIVMSG #c :first", ":srv BATCH -one");
			expect((await first).map((msg) => msg.params[1])).toEqual(["first"]);
			await Promise.resolve();
			expect(sent().filter((line) => line.startsWith("SEARCH "))).toHaveLength(1);
			recv(":srv BATCH +two soju.im/search", "@batch=two :bob PRIVMSG #c :second", ":srv BATCH -two");
			expect((await second).map((msg) => msg.params[1])).toEqual(["second"]);
		} finally {
			app.destroy();
		}
	});
});

describe("persisted UI settings", () => {
	it("refreshes the buffer cache after another tab clears local storage", () => {
		const store = new BufferStore();
		try {
			store.put({ name: "#old", server: {} });
			store.saveImmediately();
			localStorage.clear();
			window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
			expect(store.list({})).toEqual([]);
		} finally {
			store.dispose();
		}
	});

	it.each([42, {}, ["network", 42]])(
		"drops corrupt saved lists %j instead of crashing startup",
		async (value) => {
			localStorage.setItem("gamja_collapsedNetworks", JSON.stringify(value));
			const { default: AppController } = await import("../src/app/controller");
			const app = new AppController();
			try {
				expect([...app.state.collapsedNetworks]).toEqual([]);
			} finally {
				app.destroy();
			}
		},
	);
});
