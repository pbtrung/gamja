import { describe, expect, it, vi } from "vitest";
import Client, { ClientStatus } from "../src/lib/client";
import * as S from "../src/state";
import { connectedApp, flush } from "./helpers/app";
import { FakeWebSocket, installFakeWebSocket } from "./helpers/fake-ws";

const CAPS = "batch cap-notify soju.im/bouncer-networks soju.im/bouncer-networks-notify soju.im/multiplex";
const params = { url: "wss://bouncer.test", nick: "me", username: "me", realname: "Me" };

async function multiplexed() {
	installFakeWebSocket();
	const parent = new Client(params);
	const ws = FakeWebSocket.last();
	ws.open();
	ws.receive(`:srv CAP * LS :${CAPS}`);
	const request = ws.takeSent().find((m) => m.command === "CAP" && m.params[0] === "REQ")!;
	ws.receive(`:srv CAP me ACK :${request.params[1]}`, ":srv 001 me :Welcome");
	const network = new Client({ ...params, bouncerNetwork: "3", multiplexer: parent.getMultiplexer() });
	await flush();
	return { parent, network, ws };
}

async function unreadSnapshot(tags: string) {
	const { app, ws, serverID, recv } = await connectedApp({
		caps: "batch server-time draft/chathistory draft/read-marker soju.im/unread",
	});
	recv(":me!u@h JOIN #quiet");
	app.setBufferState({ server: serverID, name: "#quiet" }, { unread: S.Unread.HIGHLIGHT });
	await flush();
	recv(
		":srv BATCH +targets draft/chathistory-targets",
		`@batch=targets${tags} :srv CHATHISTORY TARGETS #quiet 2030-01-02T00:00:00.000Z`,
		":srv BATCH -targets",
	);
	await flush();
	return {
		app,
		ws,
		serverID,
		recv,
		buffer: () => S.getBuffer(app.state, { server: serverID, name: "#quiet" })!,
	};
}

describe("soju-rs protocol audit regressions", () => {
	it("replaces stale stored unread state with a read snapshot", async () => {
		const { app, buffer } = await unreadSnapshot("");
		try {
			expect(buffer().unread).toBe(S.Unread.NONE);
		} finally {
			app.destroy();
		}
	});

	it("doesn't clear unloaded unread messages when MARKREAD advances only partway", async () => {
		const { app, recv, buffer } = await unreadSnapshot(";soju.im/unread");
		try {
			recv(":srv MARKREAD #quiet timestamp=2030-01-01T00:00:00.000Z");
			expect(buffer().unread).not.toBe(S.Unread.NONE);
			recv(":srv MARKREAD #quiet timestamp=2030-01-02T00:00:00.000Z");
			expect(buffer().unread).toBe(S.Unread.NONE);
		} finally {
			app.destroy();
		}
	});

	it("preserves live messages newer than a read snapshot", async () => {
		const { app, serverID, recv, buffer } = await unreadSnapshot("");
		try {
			recv("@time=2030-01-03T00:00:00.000Z :bob!u@h PRIVMSG #quiet :hello me");
			const client = app.clients.get(serverID)!;
			app.applyUnreadSnapshot(
				buffer().id,
				client,
				{
					name: "#quiet",
					latestMessage: "2030-01-02T00:00:00.000Z",
					unread: false,
					mention: false,
				},
				S.Unread.NONE,
			);
			expect(buffer().unread).toBe(S.Unread.HIGHLIGHT);
			recv(":srv MARKREAD #quiet timestamp=2030-01-03T00:00:00.000Z");
			expect(buffer().unread).toBe(S.Unread.NONE);
		} finally {
			app.destroy();
		}
	});

	it("doesn't resurrect a snapshot already covered by a newer read marker", async () => {
		const { app, serverID, recv, buffer } = await unreadSnapshot(";soju.im/unread");
		try {
			recv(":srv MARKREAD #quiet timestamp=2030-01-03T00:00:00.000Z");
			app.applyUnreadSnapshot(
				buffer().id,
				app.clients.get(serverID)!,
				{
					name: "#quiet",
					latestMessage: "2030-01-02T00:00:00.000Z",
					unread: true,
					mention: true,
				},
				S.Unread.HIGHLIGHT,
			);
			expect(buffer().unread).toBe(S.Unread.NONE);
		} finally {
			app.destroy();
		}
	});

	it("doesn't turn private notices and non-ACTION CTCPs into mentions", async () => {
		const { app, recv, serverID } = await connectedApp();
		app.createBuffer(serverID, "bob");
		try {
			recv(":bob!u@h NOTICE me :notice");
			expect(S.getBuffer(app.state, { server: serverID, name: "bob" })!.unread).toBe(S.Unread.MESSAGE);
			recv(":bob!u@h PRIVMSG me :\x01VERSION\x01");
			expect(S.getBuffer(app.state, { server: serverID, name: "bob" })!.unread).toBe(S.Unread.MESSAGE);
			recv(":bob!u@h PRIVMSG me :\x01ACTION waves\x01");
			expect(S.getBuffer(app.state, { server: serverID, name: "bob" })!.unread).toBe(
				S.Unread.HIGHLIGHT,
			);
		} finally {
			app.destroy();
		}
	});

	it("handles the documented ATTACH rejection without a network ID", async () => {
		const { parent, network, ws } = await multiplexed();
		const errors: unknown[] = [];
		network.addEventListener("error", (event) => errors.push((event as CustomEvent).detail));
		try {
			ws.receive(
				":srv FAIL BOUNCER INVALID_CONNECTION ATTACH :Networks can only be attached to the bouncer connection",
			);
			await flush();
			expect(errors).toHaveLength(1);
			expect(network.status).toBe(ClientStatus.CONNECTING);
			expect(network.params.multiplexer).toBeNull();
			expect(FakeWebSocket.instances).toHaveLength(2);
		} finally {
			network.disconnect();
			parent.disconnect();
		}
	});

	it("doesn't send per-network keepalives over the shared transport", async () => {
		const { parent, network, ws } = await multiplexed();
		vi.useFakeTimers();
		try {
			ws.receive("@soju.im/network=3 :srv 001 me :Welcome");
			ws.takeSent();
			parent.scheduleLagCheck(2000);
			await vi.advanceTimersByTimeAsync(2000);
			expect(
				ws.sent.filter((line) => line.includes("soju.im/network=") && line.includes(" PING ")),
			).toEqual([]);
			expect(ws.sent.filter((line) => line.startsWith("PING "))).toHaveLength(1);
			parent.setLag(42);
			expect(network.lag).toBe(42);
		} finally {
			network.disconnect();
			parent.disconnect();
		}
	});

	it("routes tags before resolving batch IDs shared by two networks", async () => {
		const { parent, network, ws } = await multiplexed();
		const other = new Client({ ...params, bouncerNetwork: "4", multiplexer: parent.getMultiplexer() });
		await flush();
		const first: string[] = [];
		const second: string[] = [];
		for (const [client, messages] of [
			[network, first],
			[other, second],
		] as const) {
			client.addEventListener("message", (event) => {
				const message = (event as CustomEvent).detail.message;
				if (message.command === "PRIVMSG") {
					messages.push(`${message.batch.params[0]}: ${message.params[1]}`);
				}
			});
		}
		try {
			expect(parent.caps.enabled.has("message-tags")).toBe(false);
			ws.receive(
				"@soju.im/network=3 :srv 001 me :Welcome",
				"@soju.im/network=4 :srv 001 me :Welcome",
				"@soju.im/network=3 :srv BATCH +same chathistory #first",
				"@soju.im/network=4 :srv BATCH +same chathistory #second",
				"@soju.im/network=3;batch=same :bob!u@h PRIVMSG #first :one",
				"@soju.im/network=4;batch=same :bob!u@h PRIVMSG #second :two",
				"@soju.im/network=3 :srv BATCH -same",
				"@soju.im/network=4 :srv BATCH -same",
			);
			expect(first).toEqual(["#first: one"]);
			expect(second).toEqual(["#second: two"]);
			expect(network.batches.size).toBe(0);
			expect(other.batches.size).toBe(0);
		} finally {
			network.disconnect();
			other.disconnect();
			parent.disconnect();
		}
	});
});
