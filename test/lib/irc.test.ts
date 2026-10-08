import { describe, expect, it, vi } from "vitest";
import * as irc from "../../src/lib/irc";

describe("parseMessage", () => {
	it("parses a bare command", () => {
		expect(irc.parseMessage("PING")).toEqual({ tags: {}, prefix: null, command: "PING", params: [] });
	});

	it("parses tags, prefix, middle and trailing params", () => {
		const msg = irc.parseMessage(
			"@time=2020-01-01T00:00:00.000Z;+typing=active;bot :nick!user@host PRIVMSG #chan :hello world\r\n",
		);
		expect(msg.tags).toEqual({ time: "2020-01-01T00:00:00.000Z", "+typing": "active", bot: null });
		expect(msg.prefix).toEqual({ name: "nick", user: "user", host: "host" });
		expect(msg.command).toBe("PRIVMSG");
		expect(msg.params).toEqual(["#chan", "hello world"]);
	});

	it("keeps an empty trailing param", () => {
		expect(irc.parseMessage("TOPIC #chan :").params).toEqual(["#chan", ""]);
	});

	it("treats a colon inside a middle param as data", () => {
		expect(irc.parseMessage("CMD a:b :c d").params).toEqual(["a:b", "c d"]);
	});

	it("ignores repeated spaces between params", () => {
		expect(irc.parseMessage(":srv  001  nick  :Welcome").params).toEqual(["nick", "Welcome"]);
	});

	it("unescapes tag values", () => {
		const msg = irc.parseMessage("@a=x\\sy\\:z\\\\w\\r\\n;b=trailing\\ CMD");
		expect(msg.tags).toEqual({ a: "x y;z\\w\r\n", b: "trailing" });
	});

	it("rejects malformed input", () => {
		expect(() => irc.parseMessage("@tags-without-command")).toThrow();
		expect(() => irc.parseMessage(":prefix-only")).toThrow();
		expect(() => irc.parseMessage("")).toThrow();
	});
});

describe("formatMessage", () => {
	it("round-trips messages", () => {
		const lines = [
			"PING",
			"PRIVMSG #chan :hello world",
			"@label=1 CAP REQ :sasl batch",
			":nick!u@h JOIN #chan",
			"TOPIC #chan :",
			"PRIVMSG #chan ::)",
		];
		for (const line of lines) {
			expect(irc.formatMessage(irc.parseMessage(line))).toBe(line);
		}
	});

	it("escapes tag values", () => {
		expect(
			irc.formatMessage({ tags: { "+draft/react": "a b;c" }, command: "TAGMSG", params: ["#c"] }),
		).toBe("@+draft/react=a\\sb\\:c TAGMSG #c");
	});

	it("stringifies numeric params", () => {
		expect(irc.formatMessage({ command: "CHATHISTORY", params: ["LATEST", "#c", "*", 50] })).toBe(
			"CHATHISTORY LATEST #c * 50",
		);
	});
});

describe("tags", () => {
	it("formats valueless tags", () => {
		expect(irc.formatTags({ a: null, b: undefined, c: "", d: "x" })).toBe("a;b;c;d=x");
	});
	it("parses values containing '='", () => {
		expect(irc.parseTags("a=b=c")).toEqual({ a: "b=c" });
	});
});

describe("parsePrefix", () => {
	it("handles all forms", () => {
		expect(irc.parsePrefix("server.example")).toEqual({ name: "server.example", user: null, host: null });
		expect(irc.parsePrefix("nick@host")).toEqual({ name: "nick", user: null, host: "host" });
		expect(irc.parsePrefix("nick!user@host")).toEqual({ name: "nick", user: "user", host: "host" });
	});
});

describe("isHighlight", () => {
	const cm = irc.CaseMapping.RFC1459;
	const privmsg = (text: string, from = "alice") => irc.parseMessage(`:${from}!u@h PRIVMSG #c :${text}`);

	it("detects the nick on word boundaries", () => {
		expect(irc.isHighlight(privmsg("hey Bob!"), "bob", cm)).toBe(true);
		expect(irc.isHighlight(privmsg("bob: hi"), "bob", cm)).toBe(true);
		expect(irc.isHighlight(privmsg("bobby"), "bob", cm)).toBe(false);
		expect(irc.isHighlight(privmsg("bob-o"), "bob", cm)).toBe(false);
		expect(irc.isHighlight(privmsg("x bobby bob"), "bob", cm)).toBe(true);
	});

	it("ignores URLs and own messages", () => {
		expect(irc.isHighlight(privmsg("see https://bob.example"), "bob", cm)).toBe(false);
		expect(irc.isHighlight(privmsg("bob", "bob"), "bob", cm)).toBe(false);
	});

	it("only considers PRIVMSG and NOTICE", () => {
		expect(irc.isHighlight(irc.parseMessage(":a JOIN bob"), "bob", cm)).toBe(false);
	});

	it("applies the case-mapping", () => {
		expect(irc.isHighlight(privmsg("hi [foo]"), "{FOO}", cm)).toBe(true);
	});
});

describe("isError", () => {
	it("classifies numerics", () => {
		expect(irc.isError("401")).toBe(true);
		expect(irc.isError("001")).toBe(false);
		expect(irc.isError("904")).toBe(true);
		expect(irc.isError("FAIL")).toBe(true);
		expect(irc.isError("NOTICE")).toBe(false);
	});
});

describe("parseCTCP", () => {
	it("parses actions and commands", () => {
		expect(irc.parseCTCP(irc.parseMessage("PRIVMSG #c :\x01ACTION waves\x01"))).toEqual({
			command: "ACTION",
			param: "waves",
		});
		expect(irc.parseCTCP(irc.parseMessage("PRIVMSG #c :\x01version"))).toEqual({
			command: "VERSION",
			param: "",
		});
		expect(irc.parseCTCP(irc.parseMessage("PRIVMSG #c :hi"))).toBeNull();
	});
});

describe("Isupport", () => {
	it("parses and removes tokens", () => {
		const is = new irc.Isupport();
		is.parse(["CASEMAPPING=ascii", "NETWORK=Libera\\x20Chat", "WHOX", "MONITOR=100", "CHATHISTORY=0"]);
		expect(is.caseMapping()).toBe(irc.CaseMapping.ASCII);
		expect(is.network()).toBe("Libera Chat");
		expect(is.whox()).toBe(true);
		expect(is.monitor()).toBe(100);
		expect(is.chatHistory()).toBe(Infinity);
		is.parse(["-WHOX"]);
		expect(is.whox()).toBe(false);
	});

	it("has sane defaults", () => {
		const is = new irc.Isupport();
		expect(is.caseMapping()).toBe(irc.CaseMapping.RFC1459);
		expect(is.monitor()).toBe(0);
		expect(is.chanTypes()).toBe("#&+!");
		expect(is.membershipModes()).toEqual([
			{ mode: "o", prefix: "@" },
			{ mode: "v", prefix: "+" },
		]);
		expect(is.chanModes()).toEqual(["beI", "k", "l", "imnst"]);
		expect(is.lineLen()).toBe(512);
		expect(is.chatHistory()).toBe(0);
	});

	it("ignores unpaired PREFIX modes", () => {
		const is = new irc.Isupport();
		is.parse(["PREFIX=(o)@+"]);
		expect(is.membershipModes()).toEqual([{ mode: "o", prefix: "@" }]);
	});

	it("parses PREFIX and MONITOR without limit", () => {
		const is = new irc.Isupport();
		is.parse(["PREFIX=(qaohv)~&@%+", "MONITOR"]);
		expect(
			is
				.membershipModes()
				.map((m) => m.prefix)
				.join(""),
		).toBe("~&@%+");
		expect(is.monitor()).toBe(Infinity);
	});

	it("parses CLIENTTAGDENY", () => {
		const is = new irc.Isupport();
		expect(irc.isClientTagAllowed(is, "typing")).toBe(true);
		is.parse(["CLIENTTAGDENY=*,-typing"]);
		expect(irc.isClientTagAllowed(is, "typing")).toBe(true);
		expect(irc.isClientTagAllowed(is, "draft/react")).toBe(false);
		is.parse(["CLIENTTAGDENY=draft/react"]);
		expect(irc.isClientTagAllowed(is, "typing")).toBe(true);
		expect(irc.isClientTagAllowed(is, "draft/react")).toBe(false);
	});

	it("falls back on unknown case-mapping", () => {
		const is = new irc.Isupport();
		is.parse(["CASEMAPPING=rfc7613"]);
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(is.caseMapping()).toBe(irc.CaseMapping.RFC1459);
		expect(spy).toHaveBeenCalled();
	});
});

describe("CaseMapping", () => {
	it("maps special characters", () => {
		expect(irc.CaseMapping.RFC1459("AB{}\\~")).toBe("ab[]|^");
		expect(irc.CaseMapping.RFC1459Strict("AB{}\\~")).toBe("ab[]|~");
		expect(irc.CaseMapping.ASCII("AB{}")).toBe("ab{}");
		expect(irc.CaseMapping.byName("nope")).toBeNull();
	});
});

describe("CaseMapMap", () => {
	it("is case-insensitive and preserves original keys", () => {
		const m = new irc.CaseMapMap<number>(null, irc.CaseMapping.RFC1459);
		m.set("Alice", 1);
		expect(m.get("ALICE")).toBe(1);
		expect(m.has("alice")).toBe(true);
		expect([...m.keys()]).toEqual(["Alice"]);
		m.set("aLiCe", 2);
		expect(m.size).toBe(1);
		expect([...m]).toEqual([["aLiCe", 2]]);
		m.delete("ALICE");
		expect(m.size).toBe(0);
	});

	it("clones and re-maps", () => {
		const a = new irc.CaseMapMap<number>([["x{", 1]], irc.CaseMapping.ASCII);
		const b = new irc.CaseMapMap(a);
		b.set("y", 2);
		expect(a.size).toBe(1);
		const c = new irc.CaseMapMap(a, irc.CaseMapping.RFC1459);
		expect(c.get("X[")).toBe(1);
		expect(() => new irc.CaseMapMap(null)).toThrow();
	});
});

describe("forEachChannelModeUpdate", () => {
	it("pairs modes with their arguments", () => {
		const is = new irc.Isupport();
		is.parse(["CHANMODES=b,k,l,imnst", "PREFIX=(ov)@+"]);
		const calls: [string, boolean, string | null][] = [];
		irc.forEachChannelModeUpdate(
			irc.parseMessage("MODE #c +ob-lk+m alice *!*@x key"),
			is,
			(m, add, arg) => calls.push([m, add, arg]),
		);
		expect(calls).toEqual([
			["o", true, "alice"],
			["b", true, "*!*@x"],
			["l", false, null],
			["k", false, "key"],
			["m", true, null],
		]);
	});

	it("rejects mode strings without sign", () => {
		expect(() =>
			irc.forEachChannelModeUpdate(irc.parseMessage("MODE #c o x"), new irc.Isupport(), () => {}),
		).toThrow();
	});
});

describe("URLs", () => {
	it("parses irc:// URLs", () => {
		expect(irc.parseURL("ircs://irc.libera.chat/%23soju")).toEqual({
			host: "irc.libera.chat",
			enttype: "channel",
			entity: "#soju",
		});
		expect(irc.parseURL("irc://user@host:6667/emersion,isuser?key=x")).toEqual({
			host: "host:6667",
			enttype: "user",
			entity: "emersion",
		});
		expect(irc.parseURL("https://example.org")).toBeNull();
		expect(irc.parseURL("irc://host/%zz")).toBeNull();
	});

	it("formats irc:// URLs", () => {
		expect(irc.formatURL({ host: "h", entity: "#a b" })).toBe("irc://h/%23a%20b");
		expect(irc.formatURL({ entity: "bob", enttype: "user" })).toBe("irc:///bob,isuser");
		expect(irc.formatURL()).toBe("irc:///");
	});
});

describe("CapRegistry", () => {
	it("tracks LS/NEW/DEL/ACK", () => {
		const caps = new irc.CapRegistry();
		caps.parse(irc.parseMessage("CAP * LS * :sasl=PLAIN,EXTERNAL batch"));
		caps.parse(irc.parseMessage("CAP * LS :server-time"));
		expect([...caps.available.keys()]).toEqual(["sasl", "batch", "server-time"]);
		expect(caps.available.get("sasl")).toBe("PLAIN,EXTERNAL");

		expect(caps.requestAvailable(["batch", "unknown"])).toEqual({
			command: "CAP",
			params: ["REQ", "batch"],
		});
		caps.parse(irc.parseMessage("CAP * ACK :batch server-time"));
		expect(caps.requestAvailable(["batch"])).toBeNull();

		caps.parse(irc.parseMessage("CAP * ACK :-batch"));
		expect(caps.enabled.has("batch")).toBe(false);

		caps.parse(irc.parseMessage("CAP * NEW :away-notify"));
		expect(caps.available.has("away-notify")).toBe(true);
		caps.parse(irc.parseMessage("CAP * DEL :server-time"));
		expect(caps.available.has("server-time")).toBe(false);
		expect(caps.enabled.has("server-time")).toBe(false);
	});
});

describe("misc helpers", () => {
	it("generates chunked AUTHENTICATE messages", () => {
		const msgs = irc.generateAuthenticateMessages("x".repeat(300));
		expect(msgs).toHaveLength(2);
		expect(msgs[0].params![0]).toHaveLength(400);
		expect(msgs[1].params).toEqual(["+"]);
		expect(irc.generateAuthenticateMessages("")).toEqual([{ command: "AUTHENTICATE", params: ["+"] }]);
	});

	it("computes the max PRIVMSG length", () => {
		const is = new irc.Isupport();
		const len = irc.getMaxPrivmsgLen(is, "nick", "#chan");
		expect(len).toBe(512 - ":nick!".length - 20 - 1 - 63 - " PRIVMSG #chan :\r\n".length);
	});

	it("splits target prefixes", () => {
		expect(irc.parseTargetPrefix("@+#chan", "@+")).toEqual({ prefix: "@+", name: "#chan" });
	});

	it("finds batches and labels", () => {
		const parent = {
			name: "1",
			type: "labeled-response",
			params: [],
			tags: { label: "42" },
			parent: null,
		};
		const child = { name: "2", type: "chathistory", params: [], tags: {}, parent };
		const msg = { ...irc.parseMessage("PRIVMSG #c :x"), batch: child };
		expect(irc.findBatchByType(msg, "labeled-response")).toBe(parent);
		expect(irc.findBatchByType(msg, "netsplit")).toBeNull();
		expect(irc.getMessageLabel(msg)).toBe("42");
		expect(irc.getMessageLabel(irc.parseMessage("@label=7 PONG"))).toBe("7");
	});

	it("filters meaningless realnames", () => {
		expect(irc.isMeaningfulRealname("Alice Liddell", "alice")).toBe(true);
		expect(irc.isMeaningfulRealname("alice", "alice")).toBe(false);
		expect(irc.isMeaningfulRealname("realname", "alice")).toBe(false);
		expect(irc.isMeaningfulRealname(null, "alice")).toBe(false);
	});

	it("formats dates for server-time", () => {
		expect(irc.formatDate(new Date(Date.UTC(2021, 0, 2, 3, 4, 5, 6)))).toBe("2021-01-02T03:04:05.006Z");
	});

	it("detects server broadcasts", () => {
		expect(irc.isServerBroadcast(irc.parseMessage(":op NOTICE $* :maintenance"))).toBe(true);
		expect(irc.isServerBroadcast(irc.parseMessage(":op NOTICE #c :hi"))).toBe(false);
	});
});
