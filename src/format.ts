import * as irc from "./lib/irc";
import type { Message } from "./lib/irc";
import { BufferType, type Buffer, type Server } from "./state";

function djb2(s: string): number {
	let hash = 5381;
	for (let i = 0; i < s.length; i++) {
		hash = (hash << 5) + hash + s.charCodeAt(i);
		hash = hash >>> 0; // convert to uint32
	}
	return hash;
}

export function getNickColorIndex(nick: string): number {
	return (djb2(nick.toLowerCase()) % 16) + 1;
}

/**
 * Check whether a message can be folded.
 *
 * Unimportant and noisy messages that may clutter the discussion should be
 * folded.
 */
export function canFoldMessage(msg: Message): boolean {
	switch (msg.command) {
		case "JOIN":
		case "PART":
		case "QUIT":
		case "NICK":
			return true;
	}
	return false;
}

/** Merge NICK change chains and drop PART → JOIN pairs from a fold group. */
export function simplifyFoldGroup(msgs: Message[]): Message[] {
	const nickChanges = new Map<string, Message>();
	const mergedMsgs: Message[] = [];
	for (let msg of msgs) {
		let keep = true;
		const from = msg.prefix?.name ?? "*";
		switch (msg.command) {
			case "PART":
			case "QUIT":
				nickChanges.delete(from);
				break;
			case "NICK": {
				const prev = nickChanges.get(from);
				if (!prev) {
					// Future NICK messages may mutate this one
					msg = { ...msg };
					nickChanges.set(msg.params[0], msg);
					break;
				}

				prev.params = msg.params;
				nickChanges.delete(from);
				nickChanges.set(msg.params[0], prev);
				keep = false;
				break;
			}
		}
		if (keep) {
			mergedMsgs.push(msg);
		}
	}

	// Filter out PART → JOIN pairs, as well as no-op NICKs from previous step
	const partIndexes = new Map<string, number>();
	const keep: boolean[] = [];
	mergedMsgs.forEach((msg, i) => {
		const from = msg.prefix?.name ?? "*";
		if (msg.command === "PART" || msg.command === "QUIT") {
			partIndexes.set(from, i);
		}
		if (msg.command === "JOIN" && partIndexes.has(from)) {
			keep[partIndexes.get(from)!] = false;
			partIndexes.delete(from);
			keep.push(false);
		} else if (msg.command === "NICK" && from === msg.params[0]) {
			keep.push(false);
		} else {
			keep.push(true);
		}
	});
	return mergedMsgs.filter((_msg, i) => keep[i]);
}

export function registerProtocolHandler(): void {
	const url = window.location.origin + window.location.pathname + "?open=%s";
	try {
		navigator.registerProtocolHandler("irc", url);
		navigator.registerProtocolHandler("ircs", url);
	} catch (err) {
		console.error("Failed to register protocol handler: ", err);
	}
}

export function sortMembers(members: Iterable<[string, string]>, prefixes = "~&@%+"): [string, string][] {
	return Array.from(members).sort(([nickA, membA], [nickB, membB]) => {
		let i = prefixes.indexOf(membA[0]),
			j = prefixes.indexOf(membB[0]);
		if (i < 0) {
			i = prefixes.length;
		}
		if (j < 0) {
			j = prefixes.length;
		}
		if (i !== j) {
			return i - j;
		}
		return nickA.localeCompare(nickB);
	});
}

function matchString(s: string, query: string): number {
	return s.toLowerCase().includes(query) ? 1 : 0;
}

function matchBuffer(buf: Buffer, server: Server | undefined, query: string): number {
	let score = 2 * matchString(buf.name, query);
	switch (buf.type) {
		case BufferType.CHANNEL:
			score += matchString(buf.topic || "", query);
			break;
		case BufferType.NICK: {
			const user = server?.users.get(buf.name);
			if (user && user.realname && irc.isMeaningfulRealname(user.realname, buf.name)) {
				score += matchString(user.realname, query);
			}
			break;
		}
	}
	return score;
}

/** Rank non-server buffers against a switcher query. */
export function matchBuffers(
	buffers: Map<number, Buffer>,
	servers: Map<number, Server>,
	query: string,
	limit = 20,
): Buffer[] {
	query = query.toLowerCase();

	const l: Buffer[] = [];
	const scores = new Map<number, number>();
	for (const buf of buffers.values()) {
		if (buf.type === BufferType.SERVER) {
			continue;
		}
		let score = 0;
		if (query !== "") {
			score = matchBuffer(buf, servers.get(buf.server), query);
			if (!score) {
				continue;
			}
		}
		scores.set(buf.id, score);
		l.push(buf);
	}

	l.sort((a, b) => scores.get(b.id)! - scores.get(a.id)!);

	return l.slice(0, limit);
}
