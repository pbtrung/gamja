import { describe, expect, it } from "vitest";
import * as irc from "../src/lib/irc";
import * as S from "../src/state";
import { BufferType, SERVER_BUFFER, Unread } from "../src/state";
import type Client from "../src/lib/client";

function fakeClient(isupportTokens: string[] = [], nick = "me"): Client {
	const isupport = new irc.Isupport();
	isupport.parse(["CHANTYPES=#&", "PREFIX=(qov)~@+", ...isupportTokens]);
	const cm = isupport.caseMapping();
	return {
		nick,
		cm,
		isupport,
		caps: new irc.CapRegistry(),
		isChannel: (name: string) => "#&".includes(name[0]),
		isMyNick: (n: string) => cm(n) === cm(nick),
		supportsSASL: () => true,
		parseWhoReply: (msg: irc.Message) => ({
			nick: msg.params[1],
			flags: msg.params[2],
			account: msg.params[3] === "0" ? null : msg.params[3],
		}),
	} as unknown as Client;
}

function setup(names: string[] = []) {
	const client = fakeClient();
	let state = S.createState();
	const [serverID, update] = S.createServer(state);
	state = { ...state, ...update };
	for (const name of [SERVER_BUFFER, ...names]) {
		state = { ...state, ...S.createBuffer(state, name, serverID, client)[1] };
	}
	const handle = (line: string) => {
		const msg = irc.parseMessage(line);
		if (!msg.prefix) {
			msg.prefix = { name: "srv" };
		}
		state = { ...state, ...S.handleMessage(state, msg, serverID, client) };
		return msg;
	};
	const buf = (name: string) => S.getBuffer(state, { server: serverID, name })!;
	const user = (name: string) => state.servers.get(serverID)!.users.get(name);
	return {
		client,
		serverID,
		handle,
		buf,
		user,
		get state() {
			return state;
		},
	};
}

describe("display settings", () => {
	it("default to the previous behavior", () => {
		expect(S.defaultSettings).toMatchObject({
			showTimestamps: true,
			dateSeparators: true,
			indentWrapped: false,
			clock12h: false,
			messageTextSize: 15,
			showTyping: true,
			sendTyping: true,
		});
	});

	it("allows integer message text sizes from 10 to 20 px", () => {
		const size = (messageTextSize: unknown) =>
			S.messageTextSize({ ...S.defaultSettings, messageTextSize: messageTextSize as number });
		for (let pixels = 10; pixels <= 20; pixels++) {
			expect(size(pixels)).toBe(pixels);
		}
		for (const invalid of [9, 21, 12.5, "x", Number.NaN, Infinity]) {
			expect(size(invalid)).toBe(15);
		}
	});
});

describe("sanitizeSettings", () => {
	it("keeps valid settings and drops the rest", () => {
		expect(
			S.sanitizeSettings({
				layout: "columns",
				nickColors: false,
				nickColumnWidth: 20,
				theme: "zenburn",
				// Invalid values and unknown keys
				nickAlign: "center",
				notifications: 1,
				showTimestamps: "yes",
				autoAwayMinutes: Number.NaN,
				unknown: true,
				textSize: 125,
				toString: "x",
			}),
		).toEqual({ layout: "columns", nickColors: false, nickColumnWidth: 20, theme: "zenburn" });
	});

	it("ignores stored values which aren't settings objects", () => {
		expect(S.sanitizeSettings(null)).toEqual({});
		expect(S.sanitizeSettings("compact")).toEqual({});
		expect(S.sanitizeSettings(["compact"])).toEqual({});
	});
});

describe("backlogSize", () => {
	it("falls back to the default and stays within bounds", () => {
		const size = (backlogSize: unknown) =>
			S.backlogSize({ ...S.defaultSettings, backlogSize: backlogSize as number });
		expect(S.defaultSettings.backlogSize).toBe(200);
		expect(size(500)).toBe(500);
		expect(size(150.7)).toBe(150);
		expect(size(99)).toBe(100);
		expect(size(0)).toBe(100);
		expect(size(10000)).toBe(4000);
		expect(size("x")).toBe(200);
		expect(size(undefined)).toBe(200);
	});
});

describe("unread helpers", () => {
	it("compares and unions", () => {
		expect(S.compareUnread(Unread.HIGHLIGHT, Unread.MESSAGE)).toBeGreaterThan(0);
		expect(S.unionUnread(Unread.NONE, Unread.MESSAGE)).toBe(Unread.MESSAGE);
		expect(S.unionUnread(Unread.HIGHLIGHT, Unread.MESSAGE)).toBe(Unread.HIGHLIGHT);
	});
});

describe("receipts", () => {
	const msg = { ...irc.parseMessage("PRIVMSG #c :x"), tags: { time: "2020-01-02T00:00:00.000Z" } };
	it("compares receipts and messages", () => {
		expect(S.isReceiptBefore(null, { time: "x" })).toBe(true);
		expect(S.isReceiptBefore({ time: "a" }, null)).toBe(false);
		expect(S.isReceiptBefore({ time: "2020" }, { time: "2021" })).toBe(true);
		expect(S.isMessageBeforeReceipt(msg, { time: "2020-01-03T00:00:00.000Z" })).toBe(true);
		expect(S.isMessageBeforeReceipt(msg, { time: "2020-01-01T00:00:00.000Z" })).toBe(false);
		expect(S.isMessageBeforeReceipt(msg, null)).toBe(false);
		expect(S.receiptFromMessage(msg)).toEqual({ time: "2020-01-02T00:00:00.000Z" });
		expect(() => S.receiptFromMessage(irc.parseMessage("PING"))).toThrow();
	});
});

describe("URLs and names", () => {
	it("builds buffer and message URLs", () => {
		const buf = { type: BufferType.CHANNEL, name: "#c" } as S.Buffer;
		expect(S.getBufferURL(buf, { host: "irc.example" })).toBe("irc://irc.example/%23c");
		expect(S.getBufferURL({ type: BufferType.NICK, name: "bob" })).toBe("irc:///bob,isuser");
		expect(S.getBufferURL({ type: BufferType.SERVER, name: "*" })).toBe("irc:///");
		const msg = { ...irc.parseMessage("PRIVMSG #c :x"), tags: { msgid: "a b" } };
		expect(S.getMessageURL(buf, msg)).toBe("irc:///%23c?msgid=a%20b");
		expect(S.getMessageURL(buf, irc.parseMessage("PING"))).toBeNull();
	});

	it("picks a server name", () => {
		expect(S.getServerName({ name: "Libera", isBouncer: false }, null)).toBe("Libera");
		expect(S.getServerName({ name: null, isBouncer: true }, null)).toBe("bouncer");
		expect(S.getServerName({ name: null, isBouncer: false }, null)).toBe("server");
		expect(
			S.getServerName({ name: "Libera", isBouncer: true }, { name: "Mine", host: "irc.libera.chat" }),
		).toBe("Mine");
		expect(S.getServerName({ name: null, isBouncer: true }, { host: "irc.libera.chat" })).toBe(
			"irc.libera.chat",
		);
	});
});

describe("buffers", () => {
	it("creates sorted buffers and finds them case-insensitively", () => {
		const t = setup(["#zeta", "bob", "#Alpha", "##beta", "&local"]);
		expect([...t.state.buffers.values()].map((b) => b.name)).toEqual([
			SERVER_BUFFER,
			"#Alpha",
			"##beta",
			"&local",
			"#zeta",
			"bob",
		]);
		expect(t.buf("#alpha").name).toBe("#Alpha");
		expect(t.buf("BOB").type).toBe(BufferType.NICK);
		expect(t.buf(SERVER_BUFFER).type).toBe(BufferType.SERVER);
		// Creating an existing buffer is a no-op
		expect(S.createBuffer(t.state, "#ALPHA", t.serverID, t.client)).toEqual([t.buf("#alpha").id, null]);
	});

	it("updates buffers and servers immutably", () => {
		const t = setup(["#c"]);
		const before = t.state;
		const update = S.updateBuffer(before, { server: t.serverID, name: "#c" }, { topic: "hi" })!;
		expect(update.buffers!.get(t.buf("#c").id)!.topic).toBe("hi");
		expect(before.buffers.get(t.buf("#c").id)!.topic).toBeNull();
		expect(S.updateBuffer(before, 999, { topic: "x" })).toBeUndefined();
		expect(S.updateBuffer(before, t.buf("#c").id, () => undefined)).toBeUndefined();
		expect(S.updateServer(before, 999, { account: "x" })).toBeUndefined();
	});

	it("inserts messages in time order and skips duplicates", () => {
		const m = (time: string, msgid?: string) => ({
			...irc.parseMessage("PRIVMSG #c :x"),
			tags: msgid ? { time, msgid } : { time },
		});
		let list = S.insertMessage([], m("2020-01-02", "b"));
		list = S.insertMessage(list, m("2020-01-04", "d"));
		list = S.insertMessage(list, m("2020-01-01", "a"));
		list = S.insertMessage(list, m("2020-01-03", "c"));
		expect(list.map((x) => x.tags.msgid)).toEqual(["a", "b", "c", "d"]);
		expect(S.insertMessage(list, m("2020-01-01", "a"))).toBe(list);
		// The newest message again, e.g. from overlapping history
		expect(S.insertMessage(list, m("2020-01-04", "d"))).toBe(list);
		// Same time, different message
		expect(S.insertMessage(list, m("2020-01-04", "e")).map((x) => x.tags.msgid)).toEqual([
			"a",
			"b",
			"c",
			"d",
			"e",
		]);
	});

	it("merges pages of messages, skipping duplicates", () => {
		const m = (time: string, msgid?: string) => ({
			...irc.parseMessage("PRIVMSG #c :x"),
			tags: msgid ? { time, msgid } : { time },
		});
		const ids = (l: irc.Message[]) => l.map((x) => x.tags.msgid);
		const list = [m("2020-01-02", "b"), m("2020-01-04", "d")];
		expect(S.mergeMessages(list, [])).toBe(list);
		expect(S.mergeMessages(list, [m("2020-01-02", "b")])).toBe(list);
		expect(
			S.mergeMessages([], [m("2020-01-02", "b"), m("2020-01-01", "a")]).map((x) => x.tags.msgid),
		).toEqual(["a", "b"]);
		// Older history goes before messages sharing its time
		expect(ids(S.mergeMessages(list, [m("2020-01-01", "a"), m("2020-01-02", "a2")]))).toEqual([
			"a",
			"a2",
			"b",
			"d",
		]);
		// Otherwise new messages sharing a time go after the existing ones
		expect(
			ids(
				S.mergeMessages(list, [
					m("2020-01-02", "c"),
					m("2020-01-03", "c2"),
					m("2020-01-04", "d"),
					m("2020-01-05", "e"),
					m("2020-01-05", "e"),
				]),
			),
		).toEqual(["b", "c", "c2", "d", "e"]);
		// Newer messages, sharing a time with the last one or not, go after
		expect(ids(S.mergeMessages(list, [m("2020-01-04", "d2"), m("2020-01-06", "f")]))).toEqual([
			"b",
			"d",
			"d2",
			"f",
		]);
		// Messages without msgid are never duplicates
		expect(S.mergeMessages(list, [m("2020-01-03"), m("2020-01-03")])).toHaveLength(4);
	});

	it("adds pages of messages in one update", () => {
		const t = setup(["#c"]);
		const msg = (text: string, s: number) => ({
			...irc.parseMessage("PRIVMSG #c :" + text),
			tags: { time: `2020-01-01T00:00:0${s}.000Z` },
		});
		const bufID = { server: t.serverID, name: "#c" };
		const state = { ...t.state, ...S.addMessage(t.state, msg("b", 2), bufID) };
		const state2 = { ...state, ...S.addMessages(state, [msg("a", 1), msg("c", 3)], bufID) };
		const msgs = S.getBuffer(state2, bufID)!.messages;
		expect(msgs.map((m) => m.params[1])).toEqual(["a", "b", "c"]);
		expect(new Set(msgs.map((m) => m.key)).size).toBe(3);
		expect(S.addMessages(state2, [], bufID)).toBeUndefined();
		expect(S.addMessages(state2, [msg("x", 1)], { server: t.serverID, name: "#none" })).toBeUndefined();
	});

	it("adds messages with unique keys", () => {
		const t = setup(["#c"]);
		const a = { ...irc.parseMessage("PRIVMSG #c :a"), tags: { time: "2020-01-01T00:00:00.000Z" } };
		const b = { ...irc.parseMessage("PRIVMSG #c :b"), tags: { time: "2020-01-01T00:00:01.000Z" } };
		const state = { ...t.state, ...S.addMessage(t.state, a, { server: t.serverID, name: "#c" }) };
		const state2 = { ...state, ...S.addMessage(state, b, { server: t.serverID, name: "#c" }) };
		const msgs = S.getBuffer(state2, { server: t.serverID, name: "#c" })!.messages;
		expect(msgs.map((m) => m.params[1])).toEqual(["a", "b"]);
		expect(msgs[0].key).not.toBe(msgs[1].key);
	});
});

describe("handleMessage", () => {
	it("tracks joins, parts, kicks, quits and nick changes", () => {
		const t = setup();
		t.handle(":me!u@h JOIN #c");
		expect(t.buf("#c").joined).toBe(true);
		t.handle(":bob!bu@bh JOIN #c acct :Bob B");
		expect([...t.buf("#c").members.keys()]).toEqual(["me", "bob"]);
		expect(t.user("bob")).toMatchObject({
			username: "bu",
			hostname: "bh",
			account: "acct",
			realname: "Bob B",
			offline: false,
		});

		t.handle(":bob!bu@bh NICK robert");
		expect(t.buf("#c").members.has("robert")).toBe(true);
		expect(t.buf("#c").members.has("bob")).toBe(false);
		expect(t.user("robert")?.nick).toBe("robert");

		t.handle(":robert!bu@bh QUIT :bye");
		expect(t.buf("#c").members.has("robert")).toBe(false);
		expect(t.user("robert")?.offline).toBe(true);

		t.handle(":carol!u@h JOIN #c");
		t.handle(":me!u@h KICK #c carol :out");
		expect(t.buf("#c").members.has("carol")).toBe(false);

		t.handle(":dave!u@h JOIN #c");
		t.handle(":me!u@h PART #c");
		expect(t.buf("#c").joined).toBe(false);
		// Stale until joined again
		expect(t.buf("#c").members.size).toBe(0);
		expect(t.buf("#c").hasNames).toBe(false);
	});

	it("parses NAMES with multi-prefix and userhost-in-names", () => {
		const t = setup();
		t.handle(":me!u@h JOIN #c");
		t.handle(":srv 353 me = #c :~@alice +bob!b@host carol");
		t.handle(":srv 366 me #c :End");
		expect([...t.buf("#c").members]).toEqual([
			["alice", "~@"],
			["bob", "+"],
			["carol", ""],
		]);
	});

	it("applies membership changes received during a NAMES reply", () => {
		const t = setup();
		t.handle(":me!u@h JOIN #c");
		t.handle(":srv 353 me = #c :me bob carol dave");
		t.handle(":bob!u@h PART #c");
		t.handle(":erin!u@h JOIN #c");
		t.handle(":carol!u@h NICK caroline");
		t.handle(":me!u@h MODE #c +o dave");
		t.handle(":srv 353 me = #c :frank");
		t.handle(":srv 366 me #c :End");
		expect([...t.buf("#c").members].sort()).toEqual([
			["caroline", ""],
			["dave", "@"],
			["erin", ""],
			["frank", ""],
			["me", ""],
		]);
		expect(t.buf("#c").pendingMembers).toBeNull();
	});

	it("applies membership mode changes", () => {
		const t = setup();
		t.handle(":me!u@h JOIN #c");
		t.handle(":bob!u@h JOIN #c");
		t.handle(":me!u@h MODE #c +vo bob bob");
		expect(t.buf("#c").members.get("bob")).toBe("@+");
		t.handle(":me!u@h MODE #c -o+q bob bob");
		expect(t.buf("#c").members.get("bob")).toBe("~+");
		t.handle(":me!u@h MODE #c +b *!*@x");
		expect(t.buf("#c").members.get("bob")).toBe("~+");
		// Malformed: a membership mode without its nick
		t.handle(":me!u@h MODE #c +o");
		expect(t.buf("#c").members.get("bob")).toBe("~+");
	});

	it("keeps the buffers of a quit or renamed user in no channel", () => {
		const t = setup(["#c"]);
		const buffers = t.state.buffers;
		t.handle(":stranger!u@h QUIT :bye");
		t.handle(":stranger!u@h NICK other");
		expect(t.state.buffers).toBe(buffers);
	});

	it("ignores replies missing their target", () => {
		const t = setup(["#c"]);
		t.handle(":srv 332 me");
		t.handle(":srv TOPIC");
		expect(t.buf(SERVER_BUFFER).topic).toBeNull();
		t.handle(":srv 730 me");
		t.handle(":srv 315 me");
		expect(t.state.servers.get(t.serverID)!.users.size).toBe(0);
	});

	it("tracks topics", () => {
		const t = setup(["#c"]);
		t.handle(":srv 332 me #c :Hello");
		expect(t.buf("#c").topic).toBe("Hello");
		t.handle(":bob!u@h TOPIC #c :New");
		expect(t.buf("#c").topic).toBe("New");
		t.handle(":srv 331 me #c :No topic");
		expect(t.buf("#c").topic).toBeNull();
	});

	it("tracks user metadata", () => {
		const t = setup();
		t.handle(":bob!u@h ACCOUNT bobacct");
		expect(t.user("bob")?.account).toBe("bobacct");
		t.handle(":bob!u@h ACCOUNT *");
		expect(t.user("bob")?.account).toBeNull();
		t.handle(":bob!u@h AWAY :lunch");
		expect(t.user("bob")?.away).toBe(true);
		t.handle(":bob!u@h AWAY");
		expect(t.user("bob")?.away).toBe(false);
		t.handle(":bob!u@h SETNAME :Bobby");
		expect(t.user("bob")?.realname).toBe("Bobby");
		t.handle(":bob!u@h CHGHOST nu nh");
		expect(t.user("bob")).toMatchObject({ username: "nu", hostname: "nh" });
		t.handle(":srv 731 me bob!u@h,carol");
		expect(t.user("bob")?.offline).toBe(true);
		expect(t.user("carol")?.offline).toBe(true);
		t.handle(":srv 730 me bob");
		expect(t.user("bob")?.offline).toBe(false);
	});

	it("tracks WHO replies", () => {
		const t = setup();
		const end = irc.parseMessage(":srv 315 me #c :End");
		end.prefix = { name: "srv" };
		end.list = [irc.parseMessage(":srv 354 me bob G* acct"), irc.parseMessage(":srv 354 me carol HB 0")];
		const client = fakeClient(["BOT=B"]);
		const state = { ...t.state, ...S.handleMessage(t.state, end, t.serverID, client) };
		const users = state.servers.get(t.serverID)!.users;
		expect(users.get("bob")).toMatchObject({
			away: true,
			operator: true,
			account: "acct",
			offline: false,
		});
		expect(users.get("carol")).toMatchObject({ away: false, bot: true, account: null });

		const empty = irc.parseMessage(":srv 315 me ghost :End");
		empty.prefix = { name: "srv" };
		empty.list = [];
		const state2 = { ...state, ...S.handleMessage(state, empty, t.serverID, client) };
		expect(state2.servers.get(t.serverID)!.users.get("ghost")?.offline).toBe(true);
	});

	it("tracks our nick and server features", () => {
		const t = setup();
		t.handle(":srv 001 me_ :Welcome");
		expect(t.state.servers.get(t.serverID)!.nick).toBe("me_");
		t.client.caps.enabled.add("message-tags");
		t.client.caps.enabled.add("draft/message-redaction");
		t.handle(":srv CAP me ACK :message-tags draft/message-redaction");
		expect(t.state.servers.get(t.serverID)!.features).toMatchObject({
			reactions: true,
			replies: true,
			redaction: true,
			search: false,
		});
		t.client.isupport.parse(["CLIENTTAGDENY=draft/react"]);
		t.handle(":srv 005 me CLIENTTAGDENY=draft/react :ok");
		expect(t.state.servers.get(t.serverID)!.features.reactions).toBe(false);
		t.handle(":me!u@h NICK other");
		expect(t.state.servers.get(t.serverID)!.nick).toBe("other");
	});

	it("tracks accounts, ISUPPORT and server info", () => {
		const t = setup(["#c"]);
		t.handle(":srv 900 me me!u@h acct :Logged in");
		expect(t.state.servers.get(t.serverID)!.account).toBe("acct");
		t.handle(":srv 901 me me!u@h :Logged out");
		expect(t.state.servers.get(t.serverID)!.account).toBeNull();
		t.handle(":srv REGISTER SUCCESS newacct :ok");
		expect(t.state.servers.get(t.serverID)!.account).toBe("newacct");
		t.handle(":srv 004 me irc.test ircd-1.0 i b");
		expect(t.buf(SERVER_BUFFER).serverInfo).toEqual({ name: "irc.test", version: "ircd-1.0" });

		t.client.isupport.parse(["NETWORK=Test", "BOUNCER_NETID=7", "STATUSMSG=@"]);
		t.handle(":srv 005 me NETWORK=Test :are supported");
		const server = t.state.servers.get(t.serverID)!;
		expect(server).toMatchObject({ name: "Test", bouncerNetID: "7", statusMsg: "@" });
	});

	it("renames channels", () => {
		const t = setup(["#old", "#b"]);
		const id = t.buf("#old").id;
		t.handle(":srv RENAME #old #z :moved");
		expect(t.buf("#z").id).toBe(id);
		expect(S.getBuffer(t.state, { server: t.serverID, name: "#old" })).toBeUndefined();
		expect([...t.state.buffers.values()].map((b) => b.name)).toEqual([SERVER_BUFFER, "#b", "#z"]);
		expect(
			S.handleMessage(t.state, irc.parseMessage(":srv RENAME #nope #x"), t.serverID, t.client),
		).toBeUndefined();
	});

	it("learns accounts from account-tag", () => {
		const t = setup();
		t.handle("@account=bobacct :bob!u@h PRIVMSG #c :hi");
		expect(t.user("bob")?.account).toBe("bobacct");
		t.handle("@account=x :srv NOTICE * :server");
		expect(t.user("srv")).toBeUndefined();
	});

	it("learns bots from the bot tag", () => {
		const t = setup();
		t.handle("@bot :robo!u@h PRIVMSG #c :beep");
		expect(t.user("robo")?.bot).toBe(true);
		expect(
			S.handleMessage(
				t.state,
				irc.parseMessage("@bot :robo!u@h PRIVMSG #c :beep"),
				t.serverID,
				t.client,
			),
		).toBeUndefined();
		t.handle(":bob!u@h PRIVMSG #c :hi");
		expect(t.user("bob")).toBeUndefined();
	});

	it("marks NAMES as received", () => {
		const t = setup(["#c"]);
		expect(t.buf("#c").hasNames).toBe(false);
		const msg = irc.parseMessage(":srv 366 me #c :End");
		msg.prefix = { name: "srv" };
		msg.list = [];
		const state = { ...t.state, ...S.handleMessage(t.state, msg, t.serverID, t.client) };
		expect(S.getBuffer(state, { server: t.serverID, name: "#c" })!.hasNames).toBe(true);
	});

	it("tracks redactions", () => {
		const t = setup(["#c", "bob"]);
		t.handle(":bob!u@h REDACT #c msg1");
		expect(t.buf("#c").redacted.has("msg1")).toBe(true);
		t.handle(":bob!u@h REDACT me msg2");
		expect(t.buf("bob").redacted.has("msg2")).toBe(true);
	});

	it("ignores chat history", () => {
		const t = setup(["#c"]);
		const msg = irc.parseMessage(":bob!u@h TOPIC #c :old");
		msg.batch = { name: "1", type: "chathistory", params: [], tags: {}, parent: null };
		expect(S.handleMessage(t.state, msg, t.serverID, t.client)).toBeUndefined();
	});
});

describe("bouncer networks", () => {
	it("stores and deletes networks", () => {
		let state = S.createState();
		state = { ...state, ...S.storeBouncerNetwork(state, "1", { name: "a", state: "connecting" }) };
		state = { ...state, ...S.storeBouncerNetwork(state, "1", { state: "connected" }) };
		state = { ...state, ...S.storeBouncerNetwork(state, "1", { error: "Oops" }) };
		state = { ...state, ...S.storeBouncerNetwork(state, "1", { error: "" }) };
		expect(state.bouncerNetworks.get("1")).not.toHaveProperty("error");
		expect(state.bouncerNetworks.get("1")).toEqual({ name: "a", state: "connected" });
		state = { ...state, ...S.deleteBouncerNetwork(state, "1") };
		expect(state.bouncerNetworks.size).toBe(0);
	});
});

describe("reactions and typing", () => {
	const cm = irc.CaseMapping.RFC1459;
	const base = () => ({ reactions: new Map(), typing: new Map() }) as unknown as S.Buffer;

	it("keeps a bounded amount of reactions", () => {
		const t = setup(["#c"]);
		const cm = t.client.cm;
		let buf = t.buf("#c");
		for (let i = 0; i < 1010; i++) {
			buf = { ...buf, ...S.applyReaction(buf, "m" + i, "👍", "bob", true, cm) };
		}
		expect(buf.reactions.size).toBe(1000);
		expect(buf.reactions.has("m9")).toBe(false);
		expect(buf.reactions.has("m10")).toBe(true);
		for (let i = 0; i < 60; i++) {
			buf = { ...buf, ...S.applyReaction(buf, "m1009", "e" + i, "bob", true, cm) };
		}
		expect(buf.reactions.get("m1009")!.size).toBe(50);
		// Others can still join an existing reaction
		buf = { ...buf, ...S.applyReaction(buf, "m1009", "e0", "carol", true, cm) };
		expect(buf.reactions.get("m1009")!.get("e0")).toEqual(["bob", "carol"]);
	});

	it("adds and removes reactions", () => {
		let buf = base();
		buf = { ...buf, ...S.applyReaction(buf, "m1", "👍", "bob", true, cm) };
		buf = { ...buf, ...S.applyReaction(buf, "m1", "👍", "Carol", true, cm) };
		expect(S.applyReaction(buf, "m1", "👍", "BOB", true, cm)).toBeUndefined();
		expect(buf.reactions.get("m1")!.get("👍")).toEqual(["bob", "Carol"]);
		buf = { ...buf, ...S.applyReaction(buf, "m1", "👍", "carol", false, cm) };
		buf = { ...buf, ...S.applyReaction(buf, "m1", "👍", "bob", false, cm) };
		expect(buf.reactions.has("m1")).toBe(false);
		expect(S.applyReaction(buf, "m1", "👍", "bob", false, cm)).toBeUndefined();
	});

	it("tracks typing with expiry", () => {
		let buf = base();
		buf = { ...buf, ...S.applyTyping(buf, "bob", "active", cm, 1000) };
		buf = { ...buf, ...S.applyTyping(buf, "carol", "paused", cm, 1000) };
		expect(S.getTypingNicks(buf, 2000)).toEqual(["bob"]);
		expect(S.getTypingNicks(buf, 1000 + S.TYPING_TIMEOUT.active)).toEqual([]);
		buf = { ...buf, ...S.applyTyping(buf, "BOB", "done", cm) };
		expect(buf.typing.has("bob")).toBe(false);
		expect(S.applyTyping(buf, "dave", "done", cm)).toBeUndefined();
	});

	it("drops expired typing notifications on updates", () => {
		let buf = base();
		buf = { ...buf, ...S.applyTyping(buf, "bob", "active", cm, 1000) };
		buf = { ...buf, ...S.applyTyping(buf, "carol", "active", cm, 1000 + S.TYPING_TIMEOUT.active) };
		expect([...buf.typing.keys()]).toEqual(["carol"]);
	});
});
