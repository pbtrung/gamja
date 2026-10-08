import { beforeEach, describe, expect, it, vi } from "vitest";
import Client, { Backoff, IRCError } from "../../src/lib/client";
import { FakeWebSocket, installFakeWebSocket } from "../helpers/fake-ws";
import { flush } from "../helpers/app";

function connect(params: Partial<ConstructorParameters<typeof Client>[0]> = {}) {
	const client = new Client({
		url: "wss://irc.example/socket",
		nick: "me",
		username: "me",
		realname: "Me",
		...params,
	});
	const ws = FakeWebSocket.last();
	ws.open();
	return { client, ws };
}

/** Run a full registration with the given caps (the server ACKs everything requested). */
function register(caps = "", isupport = "CASEMAPPING=rfc1459 CHANTYPES=#") {
	const { client, ws } = connect();
	ws.takeSent();
	ws.receive(`:srv CAP * LS :${caps}`);
	const req = ws.takeSent().find((m) => m.command === "CAP" && m.params[0] === "REQ");
	if (req) {
		ws.receive(`:srv CAP me ACK :${req.params[1]}`);
	}
	ws.receive(":srv 001 me :Welcome", `:srv 005 me ${isupport} :are supported`, ":srv 376 me :End of MOTD");
	ws.takeSent();
	return { client, ws };
}

beforeEach(() => {
	installFakeWebSocket();
});

describe("Backoff", () => {
	it("grows exponentially up to the max", () => {
		const b = new Backoff(10, 50);
		expect([b.next(), b.next(), b.next(), b.next(), b.next(), b.next()]).toEqual([0, 10, 20, 40, 50, 50]);
		b.reset();
		expect(b.next()).toBe(0);
	});
});

describe("Client registration", () => {
	it("sends CAP LS, PASS, NICK and USER on open", () => {
		const { ws } = connect({ pass: "secret" });
		expect(ws.sent).toEqual(["CAP LS 302", "PASS secret", "NICK me", "USER me 0 * Me"]);
	});

	it("negotiates caps and ends negotiation", () => {
		const { client, ws } = connect();
		ws.takeSent();
		ws.receive(":srv CAP * LS * :batch server-time unknown-cap");
		expect(ws.sent).toEqual([]);
		ws.receive(":srv CAP * LS :echo-message soju.im/bouncer-networks");
		expect(ws.sent).toEqual([
			"CAP REQ :batch echo-message server-time soju.im/bouncer-networks",
			"CAP END",
		]);
		ws.receive(":srv CAP me ACK :batch server-time echo-message");
		expect(client.caps.enabled.has("echo-message")).toBe(true);
	});

	it("requests caps advertised later via CAP NEW", () => {
		const { ws } = register("batch");
		ws.receive(":srv CAP me NEW :away-notify");
		expect(ws.sent).toEqual(["CAP REQ away-notify"]);
	});

	it("ends negotiation once, even on NAK", () => {
		const { ws } = connect();
		ws.takeSent();
		ws.receive(":srv CAP * LS :batch");
		expect(ws.sent).toEqual(["CAP REQ batch", "CAP END"]);
		ws.takeSent();
		ws.receive(":srv CAP me NAK :batch");
		expect(ws.sent).toEqual([]);
	});

	it("tracks status, nick and ISUPPORT", () => {
		const statuses: string[] = [];
		const { client, ws } = connect();
		client.addEventListener("status", () => statuses.push(client.status));
		ws.receive(
			":irc.example 001 me_ :Welcome",
			":irc.example 005 me_ CASEMAPPING=ascii NETWORK=Test :ok",
		);
		expect(statuses).toEqual(["registered"]);
		expect(client.nick).toBe("me_");
		expect(client.serverPrefix.name).toBe("irc.example");
		expect(client.isupport.network()).toBe("Test");
		expect(client.cm("A{")).toBe("a{");
		expect(client.isServer("IRC.example")).toBe(true);
	});

	it("follows own nick changes", () => {
		const { client, ws } = register();
		ws.receive(":me!u@h NICK newme");
		expect(client.nick).toBe("newme");
		expect(client.isMyNick("NEWME")).toBe(true);
		ws.receive(":other!u@h NICK other2");
		expect(client.nick).toBe("newme");
	});

	it("answers PING", () => {
		const { ws } = register();
		ws.receive("PING :token");
		expect(ws.sent).toEqual(["PONG token"]);
	});

	it("binds to a bouncer network", () => {
		const { ws } = connect({ bouncerNetwork: "42" });
		ws.takeSent();
		ws.receive(":srv CAP * LS :soju.im/bouncer-networks soju.im/bouncer-networks-notify");
		const sent = ws.takeSent().map((m) => m.command + " " + m.params.join(" "));
		expect(sent).toEqual(["CAP REQ soju.im/bouncer-networks", "BOUNCER BIND 42", "CAP END"]);
	});

	it("requests event playback when enabled", () => {
		const { ws } = connect({ eventPlayback: true });
		ws.takeSent();
		ws.receive(":srv CAP * LS :draft/event-playback");
		expect(ws.takeSent()[0].params).toEqual(["REQ", "draft/event-playback"]);
	});

	it("reports fatal registration errors and disconnects", async () => {
		const { client, ws } = connect();
		const errors: unknown[] = [];
		client.addEventListener("error", (e) => errors.push((e as CustomEvent).detail));
		ws.receive(":srv 433 * me :Nickname is already in use");
		expect(errors[0]).toBeInstanceOf(IRCError);
		expect((errors[0] as Error).message).toBe("Nickname is already in use");
		expect(ws.closeCode).toBe(1000);
		await Promise.resolve();
		expect(client.status).toBe("disconnected");
	});

	it("reports ERROR messages", () => {
		const { client, ws } = register();
		const errors: Error[] = [];
		client.addEventListener("error", (e) => errors.push((e as CustomEvent).detail));
		ws.receive("ERROR :Closing link");
		expect(errors[0].message).toBe("Closing link");
	});

	it("fails on ACCOUNT_REQUIRED before registration", () => {
		const { client, ws } = connect();
		const errors: Error[] = [];
		client.addEventListener("error", (e) => errors.push((e as CustomEvent).detail));
		ws.receive("FAIL * ACCOUNT_REQUIRED :Authentication required");
		expect(errors[0].message).toBe("Authentication required");
	});

	it("rejects non-text frames", () => {
		const { ws } = register();
		vi.spyOn(console, "error").mockImplementation(() => {});
		ws.dispatchEvent(new MessageEvent("message", { data: new ArrayBuffer(1) }));
		expect(ws.closeCode).toBe(1003);
	});

	it("skips unparsable lines and stays connected", () => {
		const { client, ws } = register();
		const errors: Error[] = [];
		client.addEventListener("error", (e) => errors.push((e as CustomEvent).detail));
		vi.spyOn(console, "error").mockImplementation(() => {});
		ws.receive("@bad");
		expect(errors).toHaveLength(1);
		expect(ws.closeCode).toBeNull();
		ws.receive(":srv NICK newme");
		expect(client.status).toBe("registered");
	});

	it("ignores the old socket after reconnecting while connected", async () => {
		const { client, ws } = register();
		client.reconnect();
		const ws2 = FakeWebSocket.last();
		expect(ws2).not.toBe(ws);
		expect(ws.closeCode).toBe(1000);
		ws2.open();
		// The old socket's close event comes later and must not reset anything
		await Promise.resolve();
		expect(client.ws).toBe(ws2);
		expect(client.status).toBe("registering");
		expect(client.reconnectTimeoutID).toBeNull();
		ws.receive(":srv 001 stale :Welcome");
		expect(client.nick).toBe("me");
	});

	it("resets pending lists on disconnect", () => {
		const { client, ws } = register();
		ws.receive(":srv 353 me = #c :ghost");
		ws.serverClose();
		expect(client.pendingLists.size).toBe(0);
		client.disconnect();
	});

	it("throws when sending on a closed socket", () => {
		const client = new Client({ url: "wss://x", nick: "me", username: "me", realname: "me" });
		client.ws = null;
		expect(() => client.send({ command: "PING" })).toThrow(/socket is closed/);
	});
});

describe("SASL", () => {
	it("authenticates with PLAIN during registration", async () => {
		const { ws } = connect({ saslPlain: { username: "user", password: "pass" } });
		ws.takeSent();
		ws.receive(":srv CAP * LS :sasl=PLAIN");
		expect(ws.sent).toEqual(["CAP REQ sasl", "AUTHENTICATE PLAIN", "AUTHENTICATE AHVzZXIAcGFzcw=="]);
		// Registration only ends once SASL succeeded
		ws.takeSent();
		ws.receive(":srv CAP me ACK :sasl", "AUTHENTICATE +", ":srv 903 me :SASL authentication successful");
		await flush();
		expect(ws.sent).toEqual(["CAP END"]);
	});

	it("tries SASL when the server doesn't list mechanisms", () => {
		const { ws } = connect({ saslPlain: { username: "user", password: "pass" } });
		ws.takeSent();
		ws.receive(":srv CAP * LS :sasl");
		expect(ws.sent).toContain("AUTHENTICATE PLAIN");
	});

	it("disconnects when SASL is configured but not offered", async () => {
		const { client, ws } = connect({ saslPlain: { username: "a", password: "b" } });
		const errors: Error[] = [];
		client.addEventListener("error", (e) => errors.push((e as CustomEvent).detail));
		ws.receive(":srv CAP * LS :batch");
		await Promise.resolve();
		expect(errors[0].message).toMatch(/doesn't support SASL/);
		expect(ws.closeCode).toBe(1000);
		expect(ws.sent).not.toContain("CAP END");
	});

	it("authenticates with EXTERNAL and OAUTHBEARER", () => {
		let { ws } = connect({ saslExternal: true });
		ws.takeSent();
		ws.receive(":srv CAP * LS :sasl=EXTERNAL");
		expect(ws.sent).toContain("AUTHENTICATE +");

		({ ws } = connect({ saslOauthBearer: { token: "tok" } }));
		ws.takeSent();
		ws.receive(":srv CAP * LS :sasl=OAUTHBEARER");
		expect(ws.sent).toContain("AUTHENTICATE OAUTHBEARER");
		expect(ws.sent).toContain("AUTHENTICATE " + btoa("n,,\x01auth=Bearer tok\x01\x01"));
	});

	it("rejects unsupported mechanisms and failures", async () => {
		const { client, ws } = register("sasl=PLAIN");
		await expect(client.authenticate("EXTERNAL")).rejects.toThrow(/not supported/);
		const p = client.authenticate("PLAIN", { username: "a", password: "b" });
		ws.receive(":srv 904 me :SASL authentication failed");
		await expect(p).rejects.toThrow("SASL authentication failed");
	});

	it("resolves on success", async () => {
		const { client, ws } = register("sasl=PLAIN");
		const p = client.authenticate("PLAIN", { username: "a", password: "b" });
		ws.receive(
			":srv 900 me me!u@h a :You are now logged in",
			":srv 903 me :SASL authentication successful",
		);
		await expect(p).resolves.toBeUndefined();
	});

	it("disconnects when PLAIN is required but unsupported", () => {
		const { client, ws } = connect({ saslPlain: { username: "a", password: "b" } });
		const errors: Error[] = [];
		client.addEventListener("error", (e) => errors.push((e as CustomEvent).detail));
		ws.receive(":srv 001 me :Welcome");
		expect(errors[0].message).toMatch(/doesn't support SASL/);
	});
});

describe("roundtrip", () => {
	it("rejects on a labeled ACK", async () => {
		const { client, ws } = register("labeled-response batch");
		const p = client.roundtrip({ command: "FOO" }, () => false);
		const [req] = ws.takeSent();
		ws.receive(`@label=${req.tags.label} :srv ACK`);
		await expect(p).rejects.toThrow("No reply from the server to FOO");
	});

	it("uses labels when labeled-response is enabled and cleans up listeners", async () => {
		const { client, ws } = register("labeled-response batch");
		const p = client.ping();
		const [ping] = ws.takeSent();
		expect(ping.tags.label).toBeDefined();
		// A PONG with another label is ignored
		ws.receive(`@label=nope :srv PONG srv ${ping.params[0]}`);
		ws.receive(`@label=${ping.tags.label} :srv PONG srv ${ping.params[0]}`);
		await expect(p).resolves.toBeUndefined();

		const spy = vi.fn();
		client.addEventListener("message", spy);
		ws.receive(`@label=${ping.tags.label} :srv PONG srv ${ping.params[0]}`);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("rejects on FAIL and standard error numerics", async () => {
		const { client, ws } = register();
		const p = client.fetchHistoryBefore("#c", "2020-01-01T00:00:00.000Z", 10);
		await Promise.resolve();
		ws.receive("FAIL CHATHISTORY INVALID_TARGET #c :nope");
		await expect(p).rejects.toThrow("nope");

		const p2 = client.roundtrip({ command: "FOO" }, () => false);
		ws.receive(":srv 421 me FOO :Unknown command");
		await expect(p2).rejects.toThrow("Unknown command");
	});

	it("rejects when the connection closes", async () => {
		const { client, ws } = register();
		const p = client.ping();
		ws.serverClose(1006);
		await expect(p).rejects.toThrow("Connection closed");
	});
});

describe("commands", () => {
	it("joins channels", async () => {
		const { client, ws } = register();
		const p = client.join("#chan", "key");
		expect(ws.sent).toEqual(["JOIN #chan key"]);
		ws.receive(":Me!u@h JOIN #CHAN");
		await expect(p).resolves.toBeUndefined();

		const p2 = client.join("#banned");
		ws.receive(":srv 474 me #banned :Cannot join channel (+b)");
		await expect(p2).rejects.toThrow("Cannot join channel (+b)");
	});

	it("runs WHO queries with WHOX", async () => {
		const { client, ws } = register("", "WHOX CHANTYPES=#");
		const p = client.who("#chan", {
			fields: ["flags", "hostname", "nick", "realname", "username", "account"],
		});
		await Promise.resolve();
		const [who] = ws.takeSent();
		expect(who.params[0]).toBe("#chan");
		const [fields, token] = who.params[1].slice(1).split(",");
		expect(fields).toBe("tfhnrua");
		const msgs: unknown[] = [];
		client.addEventListener("message", (e) => msgs.push((e as CustomEvent).detail.message));
		ws.receive(`:srv 354 me ${token} user host alice H 0 :Alice`);
		ws.receive(`:srv 354 me ${token} user2 host2 bob G bobacct :Bob`);
		ws.receive(":srv 315 me #chan :End of WHO");
		await expect(p).resolves.toEqual([
			{
				username: "user",
				hostname: "host",
				nick: "alice",
				flags: "H",
				account: null,
				realname: "Alice",
			},
			{
				username: "user2",
				hostname: "host2",
				nick: "bob",
				flags: "G",
				account: "bobacct",
				realname: "Bob",
			},
		]);
		expect(msgs.every((m) => (m as { internal?: boolean }).internal)).toBe(true);
	});

	it("runs plain WHO queries", async () => {
		const { client, ws } = register();
		const p = client.who("alice", {});
		await Promise.resolve();
		expect(ws.takeSent()[0].params).toEqual(["alice"]);
		ws.receive(":srv 352 me * user host srv alice H :0 Alice L");
		ws.receive(":srv 315 me alice :End");
		const [reply] = await p;
		expect(reply).toMatchObject({ nick: "alice", realname: "Alice L", flags: "H" });
	});

	it("runs WHOIS", async () => {
		const { client, ws } = register();
		const p = client.whois("Alice");
		ws.receive(":srv 311 me alice user host * :Alice", ":srv 318 me alice :End of WHOIS");
		const whois = await p;
		expect(whois["311"].params[2]).toBe("user");

		const p2 = client.whois("ghost");
		ws.receive(":srv 401 me ghost :No such nick");
		await expect(p2).rejects.toThrow("No such nick");
	});

	it("collects NAMES replies", () => {
		const { client, ws } = register();
		const lists: unknown[] = [];
		client.addEventListener("message", (e) => {
			const msg = (e as CustomEvent).detail.message;
			if (msg.command === "366") {
				lists.push(msg.list.map((m: { params: string[] }) => m.params[3]));
			}
		});
		ws.receive(":srv 353 me = #c :@alice bob", ":srv 353 me = #c :carol", ":srv 366 me #C :End");
		expect(lists).toEqual([["@alice bob", "carol"]]);
	});

	it("fetches chat history in pages", async () => {
		const { client, ws } = register("batch draft/chathistory server-time", "CHATHISTORY=2 CHANTYPES=#");
		const p = client.fetchHistoryBetween(
			"#c",
			{ time: "2020-01-01T00:00:00.000Z" },
			{ time: "2021-01-01T00:00:00.000Z" },
			100,
		);
		await flush();
		expect(ws.takeSent()[0].params).toEqual([
			"BETWEEN",
			"#c",
			"timestamp=2020-01-01T00:00:00.000Z",
			"timestamp=2021-01-01T00:00:00.000Z",
			"2",
		]);
		ws.receive(
			":srv BATCH +a chathistory #c",
			"@batch=a;time=2020-01-02T00:00:00.000Z :x PRIVMSG #c :1",
			"@batch=a;time=2020-01-03T00:00:00.000Z :x PRIVMSG #c :2",
			":srv BATCH -a",
		);
		await flush();
		expect(ws.takeSent()[0].params[2]).toBe("timestamp=2020-01-03T00:00:00.000Z");
		ws.receive(
			":srv BATCH +b chathistory #c",
			"@batch=b;time=2020-01-04T00:00:00.000Z :x PRIVMSG #c :3",
			":srv BATCH -b",
		);
		const { messages } = await p;
		expect(messages.map((m) => m.params[1])).toEqual(["1", "2", "3"]);
	});

	it("fetches history before a date and chat history targets", async () => {
		const { client, ws } = register("batch draft/chathistory", "CHATHISTORY=50 CHANTYPES=#");
		const p = client.fetchHistoryBefore("#c", "2020-01-01T00:00:00.000Z", 100);
		await flush();
		expect(ws.takeSent()[0].params).toEqual(["BEFORE", "#c", "timestamp=2020-01-01T00:00:00.000Z", "50"]);
		ws.receive(":srv BATCH +a chathistory #c", ":srv BATCH -a");
		await expect(p).resolves.toEqual({ messages: [], more: false });

		const p2 = client.fetchHistoryTargets("t1", "t2");
		ws.receive(
			":srv BATCH +t draft/chathistory-targets",
			"@batch=t :srv CHATHISTORY TARGETS #c 2020-01-01T00:00:00.000Z",
			":srv BATCH -t",
		);
		await expect(p2).resolves.toEqual([{ name: "#c", latestMessage: "2020-01-01T00:00:00.000Z" }]);
	});

	it("doesn't report more history when CHATHISTORY ISUPPORT is missing", async () => {
		const { client, ws } = register("batch draft/chathistory", "CHANTYPES=#");
		const p = client.fetchHistoryBefore("BouncerServ", "2020-01-01T00:00:00.000Z", 100);
		await flush();
		ws.takeSent();
		ws.receive(":srv BATCH +a chathistory BouncerServ", ":srv BATCH -a");
		await expect(p).resolves.toEqual({ messages: [], more: false });
	});

	it("manages bouncer networks", async () => {
		const { client, ws } = register("batch soju.im/bouncer-networks");
		ws.takeSent();
		const p2 = client.createBouncerNetwork({ host: "irc.oftc.net", tls: "1" });
		expect(ws.sent).toEqual(["BOUNCER ADDNETWORK host=irc.oftc.net;tls=1"]);
		ws.receive(":srv BOUNCER ADDNETWORK 2");
		await expect(p2).resolves.toBe("2");
	});

	it("registers and verifies accounts", async () => {
		const { client, ws } = register("draft/account-registration=email-required");
		expect(client.checkAccountRegistrationCap("email-required")).toBe(true);
		const p = client.registerAccount("a@b.c", "pw");
		expect(ws.sent).toEqual(["REGISTER * a@b.c pw"]);
		ws.receive(":srv REGISTER VERIFICATION_REQUIRED me :Check your email");
		await expect(p).resolves.toEqual({
			verificationRequired: true,
			account: "me",
			message: "Check your email",
		});

		const p2 = client.verifyAccount("me", "123");
		ws.receive(":srv VERIFY SUCCESS me :Account verified");
		await expect(p2).resolves.toEqual({ message: "Account verified" });
	});

	it("monitors up to the MONITOR limit", () => {
		const { client, ws } = register("", "CASEMAPPING=rfc1459 CHANTYPES=# MONITOR=2");
		client.monitor("a");
		client.monitor("b");
		client.monitor("c");
		expect(ws.sent).toEqual(["MONITOR + a", "MONITOR + b"]);
	});

	it("monitors and unmonitors users", () => {
		const { client, ws } = register("", "MONITOR=10 CHANTYPES=#");
		client.monitor("alice");
		client.monitor("ALICE");
		client.unmonitor("alice");
		client.unmonitor("alice");
		expect(ws.sent).toEqual(["MONITOR + alice", "MONITOR - alice"]);
	});

	it("re-sends MONITOR when the server starts supporting it", () => {
		const { client, ws } = register();
		client.monitor("alice");
		expect(ws.sent).toEqual([]);
		ws.receive(":srv 005 me MONITOR=5 :are supported");
		expect(ws.sent).toEqual(["MONITOR + alice"]);
	});

	it("sends read markers", () => {
		const { client, ws } = register("draft/read-marker");
		expect(client.supportsReadMarker()).toBe(true);
		client.fetchReadMarker("#c");
		client.setReadMarker("#c", "2020-01-01T00:00:00.000Z");
		expect(ws.sent).toEqual(["MARKREAD #c", "MARKREAD #c timestamp=2020-01-01T00:00:00.000Z"]);
	});

	it("classifies names", () => {
		const { client } = register("", "CHANTYPES=#&");
		expect(client.isChannel("&local")).toBe(true);
		expect(client.isChannel("")).toBe(false);
		expect(client.isNick("alice")).toBe(true);
		expect(client.isNick("$*")).toBe(false);
		expect(client.isNick("srv")).toBe(false);
	});
});

describe("soju extensions", () => {
	it("requests NAMES explicitly with no-implicit-names", async () => {
		const { client, ws } = register("soju.im/no-implicit-names batch");
		expect(client.hasNoImplicitNames()).toBe(true);
		const p = client.names("#c");
		expect(ws.sent).toEqual(["NAMES #c"]);
		ws.receive(":srv 353 me = #c :@a b", ":srv 366 me #C :End");
		const end = await p;
		expect(end.list).toHaveLength(1);
	});

	it("fetches messages around a msgid", async () => {
		const { client, ws } = register("batch draft/chathistory", "CHATHISTORY=50 CHANTYPES=#");
		const p2 = client.fetchHistoryAround("#c", { msgid: "abc" }, 20);
		await flush();
		expect(ws.takeSent()[0].params).toEqual(["AROUND", "#c", "msgid=abc", "20"]);
		ws.receive(":srv BATCH +b chathistory #c", ":srv BATCH -b");
		await expect(p2).resolves.toEqual([]);
	});

	it("searches messages", async () => {
		const { client, ws } = register("batch soju.im/search");
		const p = client.search({ text: "hello world", in: "#c", limit: 10, from: "" });
		expect(ws.sent).toEqual(["SEARCH text=hello\\sworld;in=#c;limit=10"]);
		ws.receive(
			":srv BATCH +s soju.im/search",
			"@batch=s;msgid=1;time=2020-01-01T00:00:00.000Z :bob!u@h PRIVMSG #c :hello world",
			":srv BATCH -s",
		);
		const results = await p;
		expect(results.map((m) => m.params[1])).toEqual(["hello world"]);

		const p2 = client.search({ text: "x" });
		ws.receive("FAIL SEARCH INVALID_PARAMS :Invalid parameters");
		await expect(p2).rejects.toThrow("Invalid parameters");
	});

	it("registers and unregisters Web Push subscriptions", async () => {
		const { client, ws } = register("soju.im/webpush", "VAPID=BAkey CHANTYPES=#");
		expect(client.supportsWebPush()).toBe(true);
		expect(client.isupport.vapid()).toBe("BAkey");
		const p = client.registerWebPush("https://push.example/abc", { p256dh: "pk", auth: "sec" });
		expect(ws.sent).toEqual(["WEBPUSH REGISTER https://push.example/abc p256dh=pk;auth=sec"]);
		ws.receive(":srv WEBPUSH REGISTER https://push.example/abc");
		await p;
		ws.takeSent();
		const p2 = client.unregisterWebPush("https://push.example/abc");
		ws.receive(":srv WEBPUSH UNREGISTER https://push.example/abc");
		await p2;

		const p3 = client.registerWebPush("https://bad", { p256dh: "x", auth: "y" });
		ws.receive("FAIL WEBPUSH INVALID_PARAMS REGISTER https://bad :Invalid endpoint");
		await expect(p3).rejects.toThrow("Invalid endpoint");
	});
});

describe("batches", () => {
	it("attaches nested batches to messages", () => {
		const { client, ws } = register("batch");
		const seen: { batch?: { type: string; parent: { type: string } | null } }[] = [];
		client.addEventListener("message", (e) => seen.push((e as CustomEvent).detail.message));
		ws.receive(
			":srv BATCH +outer netsplit a b",
			"@batch=outer :srv BATCH +inner chathistory #c",
			"@batch=inner :x PRIVMSG #c :hi",
			":srv BATCH -inner",
			":srv BATCH -outer",
		);
		const privmsg = seen[2];
		expect(privmsg.batch?.type).toBe("chathistory");
		expect(privmsg.batch?.parent?.type).toBe("netsplit");
		expect(client.batches.size).toBe(0);
	});
});

describe("reconnection", () => {
	it("reconnects with backoff after an abnormal closure", () => {
		vi.useFakeTimers();
		const { client, ws } = register();
		const errors: Error[] = [];
		client.addEventListener("error", (e) => errors.push((e as CustomEvent).detail));
		vi.setSystemTime(Date.now() + 60_000);
		ws.serverClose(1006);
		expect(errors[0].message).toBe("Connection error (abnormal closure)");
		expect(client.status).toBe("disconnected");
		expect(client.nick).toBeNull();
		expect(FakeWebSocket.instances).toHaveLength(1);
		vi.advanceTimersByTime(0);
		expect(FakeWebSocket.instances).toHaveLength(2);
		expect(client.status).toBe("connecting");
	});

	it("waits at least the minimum delay after a recent reconnect", () => {
		vi.useFakeTimers();
		const { ws } = register();
		ws.serverClose(1006);
		vi.advanceTimersByTime(9_999);
		expect(FakeWebSocket.instances).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(FakeWebSocket.instances).toHaveLength(2);
	});

	it("does not reconnect after disconnect()", async () => {
		vi.useFakeTimers();
		const { client } = register();
		client.disconnect();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(client.status).toBe("disconnected");
	});

	it("sends periodic PINGs", () => {
		vi.useFakeTimers();
		const client = new Client({ url: "wss://x", nick: "me", username: "me", realname: "me", ping: 30 });
		const ws = FakeWebSocket.last();
		ws.open();
		ws.takeSent();
		vi.advanceTimersByTime(30_000);
		expect(ws.sent).toEqual(["PING gamja"]);
		client.disconnect();
	});
});
