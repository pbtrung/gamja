import { describe, expect, it } from "vitest";
import * as irc from "../src/lib/irc";
import {
	canFoldMessage,
	getNickColorIndex,
	matchBuffers,
	simplifyFoldGroup,
	sortMembers,
	formatReadBoundary,
} from "../src/format";
import { BufferType, type Buffer, type Server } from "../src/state";

const m = (line: string) => irc.parseMessage(line);

describe("read boundary dates", () => {
	const now = new Date(2026, 10, 9, 10, 30);
	it.each([0, 23, 24])("shows only the time for a marker %i hours old", (hours) => {
		const date = new Date(now.getTime() - hours * 60 * 60 * 1000);
		expect(formatReadBoundary(date, false, now)).toMatch(/^\d{2}:\d{2}$/);
	});
	it("adds a zero-padded DD/MM/YY date after 24 hours, retaining the selected clock format", () => {
		const date = new Date(2026, 10, 8, 9, 30);
		expect(formatReadBoundary(date, false, now)).toBe("08/11/26 09:30");
		expect(formatReadBoundary(date, true, now)).toBe("08/11/26 09:30 AM");
		expect(formatReadBoundary(new Date(now.getTime() - 86400001), false, now)).toMatch(/^08\/11\/26 /);
	});
	it("includes the year for older years and pads single-digit years", () => {
		expect(formatReadBoundary(new Date(2024, 0, 1, 12, 30), false, now)).toBe("01/01/24 12:30");
		expect(formatReadBoundary(new Date(2006, 1, 3, 12, 30), false, now)).toBe("03/02/06 12:30");
	});
});

describe("fold groups", () => {
	it("knows which messages fold", () => {
		expect(canFoldMessage(m(":a JOIN #c"))).toBe(true);
		expect(canFoldMessage(m(":a PRIVMSG #c :x"))).toBe(false);
	});

	it("merges nick chains and drops part/join pairs", () => {
		const msgs = [
			m(":a!u@h JOIN #c"),
			m(":b!u@h NICK b2"),
			m(":b2!u@h NICK b3"),
			m(":c!u@h PART #c"),
			m(":c!u@h JOIN #c"),
			m(":d!u@h NICK d2"),
			m(":d2!u@h NICK d"),
		];
		const out = simplifyFoldGroup(msgs);
		expect(out.map((x) => irc.formatMessage(x))).toEqual([":a!u@h JOIN #c", ":b!u@h NICK b3"]);
		// Input messages aren't mutated
		expect(msgs[1].params[0]).toBe("b2");
	});
});

describe("members", () => {
	it("sorts by membership then nick", () => {
		expect(
			sortMembers([
				["zed", ""],
				["amy", "+"],
				["bob", "@"],
				["al", ""],
				["owner", "~"],
			]).map(([n]) => n),
		).toEqual(["owner", "bob", "amy", "al", "zed"]);
	});
});

describe("nick colors", () => {
	it("is stable and case-insensitive", () => {
		const i = getNickColorIndex("Alice");
		expect(i).toBeGreaterThanOrEqual(1);
		expect(i).toBeLessThanOrEqual(16);
		expect(getNickColorIndex("alice")).toBe(i);
	});
});

describe("matchBuffers", () => {
	it("ranks name matches above topic matches", () => {
		const users = new irc.CaseMapMap<{ nick: string; realname: string }>(null, irc.CaseMapping.RFC1459);
		users.set("bob", { nick: "bob", realname: "Rust fan" });
		const servers = new Map([[1, { users } as unknown as Server]]);
		const buf = (id: number, name: string, type: Buffer["type"], topic: string | null = null) =>
			[id, { id, name, type, topic, server: 1 } as Buffer] as const;
		const buffers = new Map([
			buf(1, "*", BufferType.SERVER),
			buf(2, "#go", BufferType.CHANNEL, "we love rust too"),
			buf(3, "#rust", BufferType.CHANNEL),
			buf(4, "bob", BufferType.NICK),
		]);
		expect(matchBuffers(buffers, servers, "").map((b) => b.name)).toEqual(["#go", "#rust", "bob"]);
		expect(matchBuffers(buffers, servers, "RUST").map((b) => b.name)).toEqual(["#rust", "#go", "bob"]);
		expect(matchBuffers(buffers, servers, "zzz")).toEqual([]);
	});
});
