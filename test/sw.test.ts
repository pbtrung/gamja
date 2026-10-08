import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/lib/irc";
import { notificationForMessage, readTarget } from "../src/sw";

describe("service worker notifications", () => {
	it("formats channel messages, private messages and actions", () => {
		expect(notificationForMessage(parseMessage("@msgid=1 :bob!u@h PRIVMSG #c :hey \x02me\x02")!)).toEqual(
			{
				title: "bob in #c",
				body: "hey me",
				tag: "msg:1",
				target: "#c",
			},
		);
		expect(notificationForMessage(parseMessage(":bob!u@h PRIVMSG me :psst"))).toEqual({
			title: "bob",
			body: "psst",
			tag: "msg:bob:me",
			target: "bob",
		});
		expect(notificationForMessage(parseMessage(":bob!u@h PRIVMSG me :\x01ACTION waves\x01"))?.body).toBe(
			"* bob waves",
		);
	});

	it("handles invites and ignores the rest", () => {
		expect(notificationForMessage(parseMessage(":bob!u@h INVITE me #secret"))).toMatchObject({
			title: "Invitation to #secret",
			target: "#secret",
		});
		expect(notificationForMessage(parseMessage(":bob!u@h PRIVMSG me :\x01VERSION\x01"))).toBeNull();
		expect(notificationForMessage(parseMessage(":bob!u@h JOIN #c"))).toBeNull();
	});

	it("recognizes buffers read on another client, and ignores soju's NOTE", () => {
		expect(readTarget(parseMessage("MARKREAD #c timestamp=2030-01-01T00:00:00.000Z"))).toBe("#c");
		expect(readTarget(parseMessage("PRIVMSG #c :hi"))).toBeNull();
		expect(
			notificationForMessage(parseMessage("NOTE WEBPUSH REGISTERED :Push subscription registered")),
		).toBeNull();
	});
});
