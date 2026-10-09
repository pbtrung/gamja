import * as irc from "./lib/irc";
import type { Message } from "./lib/irc";
import { strip as stripANSI } from "./lib/ansi";
import { BufferType, Unread, type Buffer, type Server, type User } from "./state";

/** The user's realname without formatting, if it says more than the nick. */
export function meaningfulRealname(user: User | undefined, nick: string): string | null {
	if (!user || !irc.isMeaningfulRealname(user.realname, nick)) {
		return null;
	}
	return stripANSI(user.realname!);
}

/** Unread state for assistive technologies, which can't see the dot */
export function unreadLabel(unread: Unread): string | null {
	switch (unread) {
		case Unread.NONE:
			return null;
		case Unread.HIGHLIGHT:
			return "Mentions";
		default:
			return "Unread messages";
	}
}

/** Letter shown in a nick's avatar: the first letter or digit, if any. */
export function nickInitial(nick: string): string {
	return nick.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0) || nick.charAt(0);
}

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
			score += matchString(stripANSI(buf.topic || ""), query);
			break;
		case BufferType.NICK:
			score += matchString(meaningfulRealname(server?.users.get(buf.name), buf.name) ?? "", query);
			break;
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

export function describeTyping(nicks: string[]): string | null {
	switch (nicks.length) {
		case 0:
			return null;
		case 1:
			return `${nicks[0]} is typing…`;
		case 2:
			return `${nicks[0]} and ${nicks[1]} are typing…`;
		case 3:
			return `${nicks[0]}, ${nicks[1]} and ${nicks[2]} are typing…`;
		default:
			return "Several people are typing…";
	}
}

/** Reactions offered first by the reaction picker. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "👀", "🙏"];

/** Emoji offered by the reaction picker, with words to search them by. */
export const EMOJIS: [string, string][] = [
	["👍", "thumbs up yes ok like +1"],
	["👎", "thumbs down no dislike -1"],
	["❤️", "heart love red"],
	["😂", "joy laugh tears lol"],
	["🤣", "rofl laugh rolling floor lol"],
	["🎉", "tada party celebrate hooray"],
	["😮", "open mouth wow surprised"],
	["😢", "cry sad tear"],
	["😭", "sob cry sad bawl"],
	["👀", "eyes look see watching"],
	["🙏", "pray please thanks hope"],
	["😀", "grin smile happy"],
	["😄", "smile happy joy"],
	["😅", "sweat smile relief phew"],
	["😊", "blush smile happy"],
	["🙂", "slight smile"],
	["😉", "wink"],
	["😍", "heart eyes love"],
	["😘", "kiss love"],
	["😎", "cool sunglasses"],
	["🤔", "thinking hmm think"],
	["🤨", "raised eyebrow skeptical suspicious"],
	["😐", "neutral meh"],
	["🙄", "eye roll whatever"],
	["😬", "grimace awkward yikes"],
	["😴", "sleep tired zzz"],
	["🤯", "mind blown exploding head wow"],
	["😱", "scream fear shock omg"],
	["😡", "angry rage mad"],
	["🤬", "swear cursing angry"],
	["🥺", "pleading puppy eyes please"],
	["🥳", "party celebrate birthday"],
	["🤗", "hug hugging"],
	["🤝", "handshake deal agree"],
	["🫡", "salute respect"],
	["🙃", "upside down silly sarcasm"],
	["😇", "angel innocent halo"],
	["🤡", "clown silly"],
	["💀", "skull dead lol"],
	["👋", "wave hello hi bye"],
	["👏", "clap applause bravo"],
	["🙌", "raised hands hooray praise"],
	["💪", "muscle strong flex"],
	["✌️", "victory peace"],
	["🤞", "fingers crossed luck hope"],
	["👌", "ok perfect fine"],
	["🫶", "heart hands love"],
	["💯", "hundred perfect score"],
	["🔥", "fire hot lit"],
	["✨", "sparkles shiny new"],
	["⭐", "star favorite"],
	["⚡", "lightning zap fast"],
	["💡", "bulb idea"],
	["✅", "check done yes ok"],
	["❌", "cross no wrong cancel"],
	["⚠️", "warning caution"],
	["❓", "question what"],
	["❗", "exclamation important"],
	["💔", "broken heart sad"],
	["💚", "green heart"],
	["💙", "blue heart"],
	["💜", "purple heart"],
	["🧡", "orange heart"],
	["💛", "yellow heart"],
	["🖤", "black heart"],
	["🚀", "rocket launch ship fast"],
	["🐛", "bug insect"],
	["🎯", "target bullseye direct hit"],
	["🏆", "trophy win award"],
	["🍕", "pizza food"],
	["🍺", "beer drink cheers"],
	["☕", "coffee tea drink"],
	["🍿", "popcorn watching drama"],
	["🎂", "cake birthday"],
	["🐧", "penguin linux tux"],
	["🐱", "cat kitty"],
	["🐶", "dog puppy"],
	["🦀", "crab rust"],
	["🌈", "rainbow"],
	["☀️", "sun sunny"],
	["🌙", "moon night"],
	["⏰", "alarm clock time"],
	["📌", "pin pushpin"],
	["📝", "memo note write"],
	["🔒", "lock locked secure"],
	["🎵", "music note song"],
	["🆗", "ok button"],
	["🆒", "cool button"],
];
