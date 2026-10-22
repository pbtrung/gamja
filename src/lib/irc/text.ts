/** Message text: highlights, length limits, target lists and draft/multiline. */

import type { CaseMapFn } from "./casemapping";
import type { Isupport } from "./isupport";
import { formatMessage, type Message } from "./message";
import { byteLength, splitKeyValue } from "./util";

const alphaNum = /^[\p{L}0-9]$/u;

const space = /^\s$/;

function isWordBoundary(ch: string): boolean {
	switch (ch) {
		case "-":
		case "_":
		case "|":
			return false;
		default:
			return !alphaNum.test(ch);
	}
}

function isURIPrefix(text: string): boolean {
	for (let i = text.length - 1; i >= 0; i--) {
		if (space.test(text[i])) {
			text = text.slice(i);
			break;
		}
	}

	const i = text.indexOf("://");
	if (i <= 0) {
		return false;
	}

	// See RFC 3986 section 3
	const ch = text[i - 1];
	switch (ch) {
		case "+":
		case "-":
		case ".":
			return true;
		default:
			return alphaNum.test(ch);
	}
}

export function isHighlight(msg: Message, nick: string, cm: CaseMapFn): boolean {
	if (msg.command !== "PRIVMSG" && msg.command !== "NOTICE") {
		return false;
	}

	nick = cm(nick);
	if (!nick) {
		return false;
	}

	if (msg.prefix && cm(msg.prefix.name) === nick) {
		return false; // Our own messages aren't highlights
	}

	// Search the whole text, so that the characters around each occurrence
	// are the real ones, even right after a previous occurrence
	const text = cm(msg.params[1] ?? "");
	for (let i = text.indexOf(nick); i >= 0; i = text.indexOf(nick, i + 1)) {
		// Detect word boundaries
		const left = i > 0 ? text[i - 1] : "\x00";
		const right = i + nick.length < text.length ? text[i + nick.length] : "\x00";
		if (isWordBoundary(left) && isWordBoundary(right) && !isURIPrefix(text.slice(0, i))) {
			return true;
		}
	}
	return false;
}

export function isServerBroadcast(msg: Message): boolean {
	if (msg.command !== "PRIVMSG" && msg.command !== "NOTICE") {
		return false;
	}
	return msg.params[0]?.startsWith("$") ?? false;
}

export function getMaxPrivmsgLen(isupport: Isupport, nick: string, target: string): number {
	const user = "_".repeat(isupport.userLen());
	const host = "_".repeat(isupport.hostLen());
	const prefix = { name: nick, user, host };
	const msg = { prefix, command: "PRIVMSG", params: [target, ""] };
	const raw = formatMessage(msg) + "\r\n";
	// LINELEN counts bytes, nicks and channel names may be non-ASCII
	return isupport.lineLen() - byteLength(raw);
}

/**
 * Split targets into groups to send as one comma-separated parameter each,
 * with at most `maxTargets` targets and `maxBytes` bytes per group.
 */
export function chunkTargets(targets: string[], maxTargets = Infinity, maxBytes = 400): string[][] {
	const chunks: string[][] = [];
	let chunk: string[] = [];
	let len = 0;
	for (const target of targets) {
		const n = byteLength(target);
		// A target too long on its own still gets a group: the server judges
		if (chunk.length > 0 && (chunk.length >= maxTargets || len + 1 + n > maxBytes)) {
			chunks.push(chunk);
			chunk = [];
			len = 0;
		}
		len += (chunk.length > 0 ? 1 : 0) + n;
		chunk.push(target);
	}
	if (chunk.length > 0) {
		chunks.push(chunk);
	}
	return chunks;
}

export const MULTILINE_BATCH_TYPE = "draft/multiline";

export const MULTILINE_CONCAT_TAG = "draft/multiline-concat";

/** Line length below which multiline text isn't split further. */
const MIN_MULTILINE_LINE_LEN = 64;

export interface MultilineLimits {
	maxBytes: number;
	maxLines: number;
}

/** Parse the value of the draft/multiline capability, "max-bytes=…,max-lines=…". */
export function parseMultilineCap(value: string | undefined): MultilineLimits {
	const limits = { maxBytes: Infinity, maxLines: Infinity };
	for (const item of (value ?? "").split(",")) {
		const [k, v] = splitKeyValue(item);
		const n = parseInt(v, 10);
		if (!Number.isFinite(n) || n <= 0) {
			continue;
		}
		if (k === "max-bytes") {
			limits.maxBytes = n;
		} else if (k === "max-lines") {
			limits.maxLines = n;
		}
	}
	return limits;
}

export interface MultilineLine {
	text: string;
	/** Concatenated to the previous line, without a line break */
	concat: boolean;
}

/**
 * Split multiline text into lines of at most `maxLen` bytes. Longer lines are
 * continued by lines flagged for concatenation.
 */
export function splitMultiline(text: string, maxLen: number): MultilineLine[] {
	maxLen = Math.max(maxLen, MIN_MULTILINE_LINE_LEN);
	const lines: MultilineLine[] = [];
	for (const line of text.split("\n")) {
		let cur = "";
		let curLen = 0;
		let concat = false;
		// Code points, not to split surrogate pairs
		for (const ch of line) {
			const n = byteLength(ch);
			if (curLen + n > maxLen) {
				lines.push({ text: cur, concat });
				cur = "";
				curLen = 0;
				concat = true;
			}
			cur += ch;
			curLen += n;
		}
		lines.push({ text: cur, concat });
	}
	return lines;
}

/**
 * Join the lines of a draft/multiline batch into a single PRIVMSG or NOTICE
 * whose text contains line breaks. The message carries the tags of the BATCH
 * command. Returns null if the batch is invalid.
 */
export function joinMultiline(opener: Message, lines: Message[]): Message | null {
	const command = lines[0]?.command;
	if (
		(command !== "PRIVMSG" && command !== "NOTICE") ||
		lines.some((msg) => msg.command !== command || msg.params.length < 2)
	) {
		return null;
	}
	let text = "";
	lines.forEach((msg, i) => {
		if (i > 0 && !(MULTILINE_CONCAT_TAG in msg.tags)) {
			text += "\n";
		}
		text += msg.params[1];
	});
	return {
		tags: { ...opener.tags },
		prefix: opener.prefix ?? lines[0].prefix,
		command,
		params: [opener.params[2] ?? lines[0].params[0], text],
	};
}

/**
 * Check if a realname is worth displaying.
 *
 * Since the realname is mandatory, many clients set a meaningless realname.
 */
export function isMeaningfulRealname(realname: string | null | undefined, nick: string): boolean {
	if (!realname || realname === nick) {
		return false;
	}

	const lower = realname.toLowerCase();
	if (lower === "realname" || lower === "unknown" || lower === "fullname") {
		return false;
	}

	return true;
}
