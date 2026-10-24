import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Client, { ClientStatus, IRCError } from "../../src/lib/client";
import { addNetworkTag, splitNetworkTag } from "../../src/lib/client/multiplex";
import { FakeWebSocket, installFakeWebSocket } from "../helpers/fake-ws";
import { flush } from "../helpers/app";

const CAPS =
	"batch cap-notify message-tags server-time soju.im/bouncer-networks soju.im/bouncer-networks-notify";

const params = {
	url: "wss://bouncer.example/socket",
	nick: "me",
	username: "me",
	realname: "Me",
	pass: "secret",
};

/** Register the bouncer connection, with soju.im/multiplex unless told otherwise. */
function registerParent(client: Client, ws: FakeWebSocket, multiplex = true) {
	ws.open();
	ws.receive(`:srv CAP * LS :${CAPS}${multiplex ? " soju.im/multiplex" : ""}`);
	const req = ws.takeSent().find((m) => m.command === "CAP" && m.params[0] === "REQ")!;
	ws.receive(`:srv CAP me ACK :${req.params[1]}`, ":srv 001 me :Welcome", ":srv 376 me :End of MOTD");
	ws.takeSent();
}

function connectParent(multiplex = true) {
	const parent = new Client(params);
	const ws = FakeWebSocket.last();
	registerParent(parent, ws, multiplex);
	return { parent, ws };
}

function connectNetwork(parent: Client, netID = "3") {
	return new Client({ ...params, bouncerNetwork: netID, multiplexer: parent.getMultiplexer() });
}

beforeEach(() => {
	installFakeWebSocket();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("network tags", () => {
	it("are added to and split off raw lines", () => {
		expect(addNetworkTag("PRIVMSG #a :hi", "3")).toBe("@soju.im/network=3 PRIVMSG #a :hi");
		expect(addNetworkTag("@label=x PING a", "3")).toBe("@soju.im/network=3;label=x PING a");
		expect(splitNetworkTag("@soju.im/network=3 :n PRIVMSG #a :hi")).toEqual(["3", ":n PRIVMSG #a :hi"]);
		expect(splitNetworkTag("@time=t;soju.im/network=12;msgid=m :n PRIVMSG #a :hi")).toEqual([
			"12",
			"@time=t;msgid=m :n PRIVMSG #a :hi",
		]);
		expect(splitNetworkTag("@time=t :n PRIVMSG #a :hi")).toEqual([null, "@time=t :n PRIVMSG #a :hi"]);
		expect(splitNetworkTag("PING x")).toEqual([null, "PING x"]);
	});
});

describe("soju.im/multiplex", () => {
	it("requests the cap on the bouncer connection only", () => {
		const parent = new Client(params);
		const ws = FakeWebSocket.last();
		ws.open();
		ws.takeSent();
		ws.receive(`:srv CAP * LS :${CAPS} soju.im/multiplex`);
		const req = ws.takeSent().find((m) => m.command === "CAP" && m.params[0] === "REQ")!;
		expect(req.params[1].split(" ")).toContain("soju.im/multiplex");
		expect(parent.status).toBe(ClientStatus.REGISTERING);
	});

	it("attaches a network to the bouncer connection", async () => {
		const { parent, ws } = connectParent();
		const parentMessages: string[] = [];
		parent.addEventListener("message", (e) => {
			parentMessages.push((e as CustomEvent).detail.message.command);
		});

		const net = connectNetwork(parent);
		// No WebSocket of its own
		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(ws.sent).toEqual(["BOUNCER ATTACH 3"]);
		ws.takeSent();
		await flush();
		expect(net.status).toBe(ClientStatus.REGISTERING);
		// The caps of the bouncer connection, without the bouncer-only ones
		expect(net.caps.enabled.has("message-tags")).toBe(true);
		expect(net.caps.enabled.has("soju.im/multiplex")).toBe(false);
		expect(net.caps.enabled.has("soju.im/bouncer-networks-notify")).toBe(false);

		// The network's caps are adjusted, then it's registered
		ws.receive("@soju.im/network=3 :srv CAP me NEW :away-notify");
		expect(ws.sent).toEqual(["@soju.im/network=3 CAP REQ away-notify"]);
		ws.takeSent();
		ws.receive("@soju.im/network=3 :srv 001 me :Welcome to soju");
		expect(net.status).toBe(ClientStatus.REGISTERED);
		expect(parentMessages).toEqual([]);

		// Lines go both ways with the tag, batches are per network
		net.send({ command: "PRIVMSG", params: ["#a", "hello"] });
		expect(ws.sent).toEqual(["@soju.im/network=3 PRIVMSG #a hello"]);
		const got: string[] = [];
		net.addEventListener("message", (e) => {
			got.push((e as CustomEvent).detail.message.params.at(-1));
		});
		ws.receive(
			"@soju.im/network=3 :srv BATCH +1 chathistory #a",
			"@soju.im/network=3;batch=1 :bob!b@h PRIVMSG #a :hi",
			":srv NOTICE me :bouncer notice",
			"@soju.im/network=3 :srv BATCH -1",
		);
		expect(got).toContain("hi");
		expect(got).not.toContain("bouncer notice");
		expect(parentMessages).toEqual(["NOTICE"]);
	});

	it("detaches the network when its client disconnects", async () => {
		const { parent, ws } = connectParent();
		const net = connectNetwork(parent);
		await flush();
		ws.receive("@soju.im/network=3 :srv 001 me :Welcome");
		ws.takeSent();
		net.disconnect();
		expect(ws.sent).toEqual(["BOUNCER DETACH 3"]);
		await flush();
		expect(net.status).toBe(ClientStatus.DISCONNECTED);
		// Late lines of the detached network are dropped
		ws.receive("@soju.im/network=3 :bob!b@h PRIVMSG me :late");
		expect(net.status).toBe(ClientStatus.DISCONNECTED);
	});

	it("attaches once the bouncer connection is registered", async () => {
		const parent = new Client(params);
		const ws = FakeWebSocket.last();
		const net = connectNetwork(parent);
		await flush();
		expect(net.status).toBe(ClientStatus.CONNECTING);
		registerParent(parent, ws);
		// Sent with the end of the registration, then taken by registerParent
		expect(FakeWebSocket.instances).toHaveLength(1);
		await flush();
		expect(net.status).toBe(ClientStatus.REGISTERING);
	});

	it("goes with the bouncer connection, and comes back with it", async () => {
		const { parent, ws } = connectParent();
		const net = connectNetwork(parent);
		await flush();
		ws.receive("@soju.im/network=3 :srv 001 me :Welcome");
		const errors: unknown[] = [];
		net.addEventListener("error", (e) => errors.push((e as CustomEvent).detail));

		ws.serverClose(1006);
		await flush();
		expect(net.status).toBe(ClientStatus.DISCONNECTED);
		// The bouncer connection reports the error, not each network
		expect(errors).toEqual([]);

		parent.reconnect();
		const ws2 = FakeWebSocket.last();
		expect(ws2).not.toBe(ws);
		registerParent(parent, ws2);
		await flush();
		// Reconnected right away, without waiting for its own delay
		expect(net.status).toBe(ClientStatus.REGISTERING);
		ws2.receive("@soju.im/network=3 :srv 001 me :Welcome");
		expect(net.status).toBe(ClientStatus.REGISTERED);
		expect(FakeWebSocket.instances).toHaveLength(2);
	});

	it("reports a failed ATTACH on the network", async () => {
		const { parent, ws } = connectParent();
		const net = connectNetwork(parent, "9");
		const errors: unknown[] = [];
		net.addEventListener("error", (e) => errors.push((e as CustomEvent).detail));
		await flush();
		ws.receive(":srv FAIL BOUNCER INVALID_NETID ATTACH 9 :Invalid network ID");
		await flush();
		expect(errors).toHaveLength(1);
		expect(errors[0]).toBeInstanceOf(IRCError);
		expect(net.status).toBe(ClientStatus.DISCONNECTED);
	});

	it("reconnects on its own after a tagged ERROR", async () => {
		vi.useFakeTimers();
		const { parent, ws } = connectParent();
		const net = connectNetwork(parent);
		await vi.advanceTimersByTimeAsync(0);
		ws.receive("@soju.im/network=3 :srv 001 me :Welcome");
		ws.takeSent();
		ws.receive("@soju.im/network=3 ERROR :Closing link");
		await vi.advanceTimersByTimeAsync(0);
		expect(net.status).toBe(ClientStatus.DISCONNECTED);
		expect(ws.sent).toEqual(["BOUNCER DETACH 3"]);
		ws.takeSent();
		await vi.advanceTimersByTimeAsync(60 * 1000);
		// Among the bouncer connection's own lag checks
		expect(ws.sent.filter((l) => l.startsWith("BOUNCER"))).toEqual(["BOUNCER ATTACH 3"]);
	});

	it("falls back to a connection per network without the cap", async () => {
		const { parent, ws } = connectParent();
		const net = connectNetwork(parent);
		await flush();
		ws.receive("@soju.im/network=3 :srv 001 me :Welcome");

		// The bouncer restarted without soju.im/multiplex
		ws.serverClose(1006);
		await flush();
		parent.reconnect();
		registerParent(parent, FakeWebSocket.last(), false);
		await flush();
		expect(net.params.multiplexer).toBeNull();
		const own = FakeWebSocket.last();
		expect(own.url).toBe(params.url);
		own.open();
		expect(own.sentCommands()).toEqual(["CAP", "PASS", "NICK", "USER"]);
	});
});
