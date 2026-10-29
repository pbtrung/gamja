/** Reactions and typing notifications, sent by other users with client tags. */

import type { CaseMapFn } from "../lib/irc";
import { TYPING_TIMEOUT, type Buffer } from "./model";

// Reactions come from other users, who could reference any number of
// messages or emoji: keep a bounded amount
const MAX_REACTED_MESSAGES = 1000;
const MAX_EMOJI_PER_MESSAGE = 50;

/**
 * Add or remove a reaction to a message, which may not be loaded (yet).
 * The reactions of the messages reacted to first go first past the limit.
 */
export function applyReaction(
	buf: Buffer,
	msgid: string,
	emoji: string,
	nick: string,
	add: boolean,
	cm: CaseMapFn,
): Partial<Buffer> | undefined {
	const byEmoji = new Map(buf.reactions.get(msgid));
	const nicks = byEmoji.get(emoji) ?? [];
	const has = nicks.some((n) => cm(n) === cm(nick));
	if (has === add || (add && nicks.length === 0 && byEmoji.size >= MAX_EMOJI_PER_MESSAGE)) {
		return;
	}
	const updated = add ? [...nicks, nick] : nicks.filter((n) => cm(n) !== cm(nick));
	if (updated.length > 0) {
		byEmoji.set(emoji, updated);
	} else {
		byEmoji.delete(emoji);
	}
	const reactions = new Map(buf.reactions);
	if (byEmoji.size > 0) {
		reactions.set(msgid, byEmoji);
	} else {
		reactions.delete(msgid);
	}
	for (const oldest of reactions.keys()) {
		if (reactions.size <= MAX_REACTED_MESSAGES) {
			break;
		}
		reactions.delete(oldest);
	}
	return { reactions };
}

/** Update the typing status of a user, "done" clears it. */
export function applyTyping(
	buf: Buffer,
	nick: string,
	status: string,
	cm: CaseMapFn,
	now = Date.now(),
): Partial<Buffer> | undefined {
	const typing = new Map(buf.typing);
	let had = false;
	for (const [k, t] of typing) {
		if (cm(k) === cm(nick)) {
			typing.delete(k);
			had = true;
		} else if (now - t.time >= TYPING_TIMEOUT[t.status]) {
			// Drop expired notifications while at it: users who never sent
			// "done" would stay in the map otherwise
			typing.delete(k);
		}
	}
	if (status === "active" || status === "paused") {
		typing.set(nick, { status, time: now });
	} else if (!had) {
		return;
	}
	return { typing };
}

/** Nicks currently typing in a buffer, excluding expired notifications. */
export function getTypingNicks(buf: Buffer, now = Date.now()): string[] {
	const nicks: string[] = [];
	for (const [nick, t] of buf.typing) {
		if (now - t.time < TYPING_TIMEOUT[t.status] && t.status === "active") {
			nicks.push(nick);
		}
	}
	return nicks;
}
