import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as irc from "../../src/lib/irc";
import * as ansi from "../../src/lib/ansi";
import * as base64 from "../../src/lib/base64";
import { insertMessage } from "../../src/state";

// Tokens that can appear in middle params, commands and tag keys
const word = fc.stringMatching(/^[A-Za-z0-9#&+!@._\-[\]{}|^]{1,12}$/).filter((s) => !s.startsWith(":"));
// Prefix parts can't contain the "!" and "@" separators
const prefixPart = fc.stringMatching(/^[A-Za-z0-9#&+._\-[\]{}|^]{1,12}$/).filter((s) => !s.startsWith(":"));
const tagKey = fc.stringMatching(/^\+?[a-z][a-z0-9-]{0,8}(\/[a-z][a-z0-9-]{0,8})?$/);
// Tag values and trailing params can contain anything but NUL, CR and LF
const text = fc.string({ unit: "grapheme", maxLength: 40 }).map((s) => s.replace(/[\0\r\n]/g, ""));

const message = fc.record({
	tags: fc.dictionary(
		tagKey,
		fc.option(
			text.filter((s) => s.length > 0),
			{ nil: null },
		),
		{ maxKeys: 4 },
	),
	prefix: fc.option(
		fc.record({
			name: prefixPart,
			user: fc.option(prefixPart, { nil: null }),
			host: fc.option(prefixPart, { nil: null }),
		}),
		{ nil: null },
	),
	command: fc.oneof(
		fc.constantFrom("PRIVMSG", "NOTICE", "TAGMSG", "JOIN", "001", "353"),
		fc.stringMatching(/^[A-Z]{1,10}$/),
	),
	params: fc
		.tuple(fc.array(word, { maxLength: 4 }), fc.option(text, { nil: undefined }))
		.map(([middle, trailing]) => (trailing === undefined ? middle : [...middle, trailing])),
});

describe("IRC message properties", () => {
	it("round-trips through format and parse", () => {
		fc.assert(
			fc.property(message, (msg) => {
				const parsed = irc.parseMessage(irc.formatMessage(msg));
				expect(parsed.command).toBe(msg.command);
				expect(parsed.params).toEqual(msg.params);
				expect(parsed.tags).toEqual(msg.tags);
				if (msg.prefix) {
					expect(parsed.prefix).toEqual(msg.prefix);
				} else {
					expect(parsed.prefix).toBeNull();
				}
			}),
			{ numRuns: 500 },
		);
	});

	it("round-trips tags with arbitrary values", () => {
		fc.assert(
			fc.property(
				fc.dictionary(
					tagKey,
					text.filter((s) => s.length > 0),
				),
				(tags) => {
					expect(irc.parseTags(irc.formatTags(tags))).toEqual(tags);
				},
			),
		);
	});

	it("never throws on arbitrary input lines, only on structural errors", () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 80 }), (line) => {
				try {
					const msg = irc.parseMessage(line);
					expect(typeof msg.command).toBe("string");
				} catch (err) {
					expect(err).toBeInstanceOf(Error);
				}
			}),
			{ numRuns: 1000 },
		);
	});
});

describe("CaseMapMap properties", () => {
	it("behaves like a Map keyed by the case-mapped name", () => {
		const op = fc.tuple(
			fc.constantFrom("set", "delete"),
			fc.stringMatching(/^[A-Za-z{}[\]\\|~^]{1,4}$/),
			fc.integer(),
		);
		fc.assert(
			fc.property(fc.array(op, { maxLength: 30 }), (ops) => {
				const cm = irc.CaseMapping.RFC1459;
				const m = new irc.CaseMapMap<number>(null, cm);
				const model = new Map<string, number>();
				for (const [kind, key, value] of ops) {
					if (kind === "set") {
						m.set(key, value);
						model.set(cm(key), value);
					} else {
						m.delete(key);
						model.delete(cm(key));
					}
				}
				expect(m.size).toBe(model.size);
				for (const [k, v] of m) {
					expect(model.get(cm(k))).toBe(v);
				}
			}),
		);
	});

	it("case-mapping is idempotent", () => {
		fc.assert(
			fc.property(fc.string(), (s) => {
				for (const cm of [
					irc.CaseMapping.ASCII,
					irc.CaseMapping.RFC1459,
					irc.CaseMapping.RFC1459Strict,
				]) {
					expect(cm(cm(s))).toBe(cm(s));
				}
			}),
		);
	});
});

describe("formatting properties", () => {
	const formatting = fc.array(
		fc.oneof(
			text,
			fc.constantFrom(
				"\x02",
				"\x1d",
				"\x1f",
				"\x1e",
				"\x11",
				"\x16",
				"\x0f",
				"\x03",
				"\x034",
				"\x0304,12",
				"\x04ff00ff",
			),
		),
		{ maxLength: 12 },
	);

	it("stripping removes every control code and keeps the text", () => {
		fc.assert(
			fc.property(text, (s) => {
				// eslint-disable-next-line no-control-regex -- IRC formatting codes
				const clean = s.replace(/[\x02\x03\x04\x0f\x11\x16\x1d\x1e\x1f]/g, "");
				expect(ansi.strip(clean)).toBe(clean);
			}),
		);
		fc.assert(
			fc.property(formatting, (parts) => {
				const stripped = ansi.strip(parts.join(""));
				// eslint-disable-next-line no-control-regex -- IRC formatting codes
				expect(stripped).not.toMatch(/[\x02\x0f\x11\x16\x1d\x1e\x1f]/);
				expect(ansi.strip(stripped)).toBe(stripped);
			}),
		);
	});
});

describe("message ordering", () => {
	it("keeps messages sorted by time regardless of arrival order", () => {
		fc.assert(
			fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 1e9 }), { maxLength: 30 }), (times) => {
				let list: irc.Message[] = [];
				for (const t of times) {
					const time = new Date(1.7e12 + t).toISOString();
					list = insertMessage(list, {
						tags: { time, msgid: String(t) },
						prefix: null,
						command: "PRIVMSG",
						params: [],
					});
				}
				const sorted = [...times].sort((a, b) => a - b).map(String);
				expect(list.map((m) => m.tags.msgid)).toEqual(sorted);
			}),
		);
	});
});

describe("base64 properties", () => {
	it("matches the platform encoder for UTF-8 strings", () => {
		fc.assert(
			fc.property(fc.string({ unit: "grapheme" }), (s) => {
				expect(base64.encode(s)).toBe(Buffer.from(s, "utf8").toString("base64"));
			}),
		);
	});

	it("round-trips base64url bytes", () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
				expect([...base64.decodeURL(base64.encodeURL(bytes.slice().buffer))]).toEqual([...bytes]);
			}),
		);
	});
});
