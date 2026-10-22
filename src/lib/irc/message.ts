/** IRC messages: types, parsing and formatting, CTCP and batches. */

import {
	ERR_MONLISTFULL,
	ERR_NICKLOCKED,
	ERR_SASLABORTED,
	ERR_SASLALREADY,
	ERR_SASLFAIL,
	ERR_SASLTOOLONG,
} from "./numerics";

export type Tags = Record<string, string | null | undefined>;

export interface Prefix {
	name: string;
	user?: string | null;
	host?: string | null;
}

export interface Batch {
	name: string;
	type: string;
	params: string[];
	tags: Tags;
	parent: Batch | null;
}

/** An IRC message, as parsed from the wire or built for sending. */
export interface Message {
	tags: Tags;
	prefix: Prefix | null;
	command: string;
	params: string[];
	/** Batch the message belongs to, set by the client */
	batch?: Batch | null;
	/** Pending list of replies, set by the client for NAMES/WHO/WHOIS */
	list?: Message[];
	/** Reply to a command sent internally by the client */
	internal?: boolean;
	/** Set by the UI */
	isHighlight?: boolean;
	key?: number;
}

/** A message to send. Tags and prefix are optional. */
export interface OutgoingMessage {
	tags?: Tags;
	prefix?: Prefix | null;
	command: string;
	params?: (string | number)[];
}

const tagEscapeMap: Record<string, string> = {
	";": "\\:",
	" ": "\\s",
	"\\": "\\\\",
	"\r": "\\r",
	"\n": "\\n",
};

const tagUnescapeMap = Object.fromEntries(Object.entries(tagEscapeMap).map(([from, to]) => [to, from]));

function escapeTag(s: string): string {
	return String(s).replace(/[; \\\r\n]/g, (ch) => tagEscapeMap[ch]);
}

function unescapeTag(s: string): string {
	return s.replace(/\\[:s\\rn]?/g, (seq) => tagUnescapeMap[seq] ?? "");
}

export function parseTags(s: string): Tags {
	const tags: Tags = {};
	for (const item of s.split(";")) {
		if (!item) {
			continue;
		}
		const i = item.indexOf("=");
		if (i < 0) {
			tags[item] = null;
		} else {
			tags[item.slice(0, i)] = unescapeTag(item.slice(i + 1));
		}
	}
	return tags;
}

export function formatTags(tags: Tags): string {
	const l: string[] = [];
	for (let k in tags) {
		const v = tags[k]?.replace(/\0/g, "");
		// Escaping can't help in keys
		k = k.replace(/[\0\r\n]/g, "");
		if (/[= ;]/.test(k)) {
			throw new Error(`Invalid IRC tag key "${k}"`);
		}
		if (v === undefined || v === null || v === "") {
			l.push(k);
			continue;
		}
		l.push(k + "=" + escapeTag(v));
	}
	return l.join(";");
}

export function parsePrefix(s: string): Prefix {
	let host: string | null = null;
	let i = s.indexOf("@");
	if (i > 0) {
		host = s.slice(i + 1);
		s = s.slice(0, i);
	}

	let user: string | null = null;
	i = s.indexOf("!");
	if (i > 0) {
		user = s.slice(i + 1);
		s = s.slice(0, i);
	}

	return { name: s, user, host };
}

function formatPrefix(prefix: Prefix): string {
	let s = prefix.name;
	if (prefix.user) {
		s += "!" + prefix.user;
	}
	if (prefix.host) {
		s += "@" + prefix.host;
	}
	return s;
}

/** The rest of s from i, after the spaces there. */
function skipSpaces(s: string, i: number): string {
	while (s[i] === " ") {
		i++;
	}
	return s.slice(i);
}

export function parseMessage(s: string): Message {
	if (s.endsWith("\r\n")) {
		s = s.slice(0, s.length - 2);
	} else if (s.endsWith("\n")) {
		s = s.slice(0, s.length - 1);
	}

	const msg: Message = {
		tags: {},
		prefix: null,
		command: "",
		params: [],
	};

	if (s.startsWith("@")) {
		const i = s.indexOf(" ");
		if (i < 0) {
			throw new Error("expected a space after tags");
		}
		msg.tags = parseTags(s.slice(1, i));
		s = skipSpaces(s, i + 1);
	}

	if (s.startsWith(":")) {
		const i = s.indexOf(" ");
		if (i < 0) {
			throw new Error("expected a space after prefix");
		}
		msg.prefix = parsePrefix(s.slice(1, i));
		s = skipSpaces(s, i + 1);
	}

	let i = s.indexOf(" ");
	if (i < 0) {
		msg.command = s;
		if (!msg.command) {
			throw new Error("missing command");
		}
		return msg;
	}
	msg.command = s.slice(0, i);
	s = s.slice(i + 1);

	while (s.length > 0) {
		if (s.startsWith(":")) {
			msg.params.push(s.slice(1));
			break;
		}

		i = s.indexOf(" ");
		if (i < 0) {
			msg.params.push(s);
			break;
		}

		if (i > 0) {
			msg.params.push(s.slice(0, i));
		}
		s = s.slice(i + 1);
	}

	return msg;
}

/** Characters that would end the line or the string early on the wire */
const unsafeLineChars = /[\r\n\0]/;

export function formatMessage(msg: OutgoingMessage): string {
	// Refuse rather than let a crafted value inject another command
	if (unsafeLineChars.test(msg.command) || msg.params?.some((p) => unsafeLineChars.test(String(p)))) {
		throw new Error("IRC message contains a line break or NUL character");
	}
	let s = "";
	if (msg.tags && Object.keys(msg.tags).length > 0) {
		s += "@" + formatTags(msg.tags) + " ";
	}
	if (msg.prefix) {
		s += ":" + formatPrefix(msg.prefix) + " ";
	}
	s += msg.command;
	if (msg.params && msg.params.length > 0) {
		for (let i = 0; i < msg.params.length - 1; i++) {
			// Only the last parameter can be empty, contain spaces or start
			// with a colon, the others would be split or merged
			const param = String(msg.params[i]);
			if (param === "" || param.startsWith(":") || param.includes(" ")) {
				throw new Error(`Invalid IRC message parameter "${param}" for ${msg.command}`);
			}
			s += " " + param;
		}

		const last = String(msg.params[msg.params.length - 1]);
		if (last.length === 0 || last.startsWith(":") || last.indexOf(" ") >= 0) {
			s += " :" + last;
		} else {
			s += " " + last;
		}
	}
	return s;
}

/** Split a prefix and a name out of a target. */
export function parseTargetPrefix(s: string, allowedPrefixes: string): { prefix: string; name: string } {
	let i;
	for (i = 0; i < s.length; i++) {
		if (allowedPrefixes.indexOf(s[i]) < 0) {
			break;
		}
	}

	return {
		prefix: s.slice(0, i),
		name: s.slice(i),
	};
}

export function isError(cmd: string): boolean {
	if (/^\d{3}$/.test(cmd) && cmd >= "400" && cmd <= "568") {
		return true;
	}
	switch (cmd) {
		case ERR_NICKLOCKED:
		case ERR_SASLFAIL:
		case ERR_SASLTOOLONG:
		case ERR_SASLABORTED:
		case ERR_SASLALREADY:
		case ERR_MONLISTFULL:
		case "FAIL":
			return true;
		default:
			return false;
	}
}

export function formatDate(date: Date): string {
	// ISO 8601 with millisecond precision, as required by server-time
	return date.toISOString();
}

export interface CTCP {
	command: string;
	param: string;
}

export function parseCTCP(msg: Message): CTCP | null {
	if (msg.command !== "PRIVMSG" && msg.command !== "NOTICE") {
		return null;
	}

	let text = msg.params[1] ?? "";
	if (!text.startsWith("\x01")) {
		return null;
	}
	text = text.slice(1);
	if (text.endsWith("\x01")) {
		text = text.slice(0, -1);
	}

	let ctcp: CTCP;
	const i = text.indexOf(" ");
	if (i >= 0) {
		ctcp = { command: text.slice(0, i), param: text.slice(i + 1) };
	} else {
		ctcp = { command: text, param: "" };
	}
	ctcp.command = ctcp.command.toUpperCase();
	return ctcp;
}

/** The batch of a message, then the batches enclosing it. */
export function* batchAncestry(msg: Message): Generator<Batch> {
	for (let batch = msg.batch; batch; batch = batch.parent) {
		yield batch;
	}
}

/** Parse the reference tag of a BATCH message, "+name" or "-name". */
export function parseBatchRef(msg: Message): { start: boolean; name: string } {
	const ref = msg.params[0] ?? "";
	return { start: ref.startsWith("+"), name: ref.slice(1) };
}

export function findBatchByType(msg: Message, type: string): Batch | null {
	for (const batch of batchAncestry(msg)) {
		if (batch.type === type) {
			return batch;
		}
	}
	return null;
}

export function getMessageLabel(msg: Message): string | null {
	if (msg.tags.label) {
		return msg.tags.label;
	}
	for (const batch of batchAncestry(msg)) {
		if (batch.tags.label) {
			return batch.tags.label;
		}
	}
	return null;
}
