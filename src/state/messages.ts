/** Sorted message lists, receipts and history bounds. */

import type { Message } from "../lib/irc";
import type { HistoryBound, Receipt } from "./model";

export function boundFromMessage(msg: Message): HistoryBound {
	return { time: receiptFromMessage(msg).time, msgid: msg.tags.msgid ?? undefined };
}

export function receiptFromMessage(msg: Message): Receipt {
	// At this point all messages are supposed to have a time tag.
	// The controller ensures this is the case even if the server doesn't
	// support server-time.
	if (!msg.tags.time) {
		throw new Error("Missing time message tag");
	}
	return { time: msg.tags.time };
}

export function isReceiptBefore(a: Receipt | null | undefined, b: Receipt | null | undefined): boolean {
	if (!b) {
		return false;
	}
	if (!a) {
		return true;
	}
	if (!a.time || !b.time) {
		throw new Error("Missing receipt time");
	}
	return a.time <= b.time;
}

export function isMessageBeforeReceipt(msg: Message, receipt: Receipt | null | undefined): boolean {
	if (!receipt) {
		return false;
	}
	return isReceiptBefore(receiptFromMessage(msg), receipt);
}

/** Index of the first message of a sorted list newer than the given time. */
function upperBound(list: Message[], time: string): number {
	let lo = 0;
	let hi = list.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (list[mid].tags.time! <= time) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

/* Insert a message in an immutable list of sorted messages. */
export function insertMessage(list: Message[], msg: Message): Message[] {
	// IDs identify messages independently of replay timestamps.
	const msgid = msg.tags.msgid;
	if (msgid && list.some((m) => m.tags.msgid === msgid)) {
		return list;
	}

	const insertBefore = upperBound(list, msg.tags.time!);
	if (insertBefore === list.length) {
		return list.concat(msg);
	}
	list = [...list];
	list.splice(insertBefore, 0, msg);
	return list;
}

function compareMessageTime(a: Message, b: Message): number {
	const ta = a.tags.time!;
	const tb = b.tags.time!;
	return ta < tb ? -1 : ta > tb ? 1 : 0;
}

/** Exact delivery contents, excluding tags which change during history playback. */
function replayKey(msg: Message): string {
	const tags = Object.entries(msg.tags)
		.filter(([key]) => key !== "batch" && key !== "label" && key !== "msgid")
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return JSON.stringify([
		msg.prefix?.name,
		msg.prefix?.user ?? null,
		msg.prefix?.host ?? null,
		msg.command,
		msg.params,
		tags,
	]);
}

/**
 * Merge messages, e.g. a page of history, into an immutable list of sorted
 * messages, skipping duplicates.
 */
export function mergeMessages(list: Message[], msgs: Message[]): Message[] {
	if (msgs.length === 0) {
		return list;
	}
	const seen = new Set<string>();
	// Only match against the existing list: identical messages in a single
	// page may be intentional. Consume each existing delivery at most once.
	type Delivery = { message: Message; matched: boolean };
	const byContents = new Map<string, Delivery[]>();
	const byID = new Map<string, Delivery>();
	for (const msg of list) {
		const delivery = { message: msg, matched: false };
		const key = replayKey(msg);
		const deliveries = byContents.get(key);
		if (deliveries) {
			deliveries.push(delivery);
		} else {
			byContents.set(key, [delivery]);
		}
		if (msg.tags.msgid) {
			seen.add(msg.tags.msgid);
			byID.set(msg.tags.msgid, delivery);
		}
	}
	// Reserve exact ID matches before matching messages without IDs, so a
	// missing-ID delivery can't consume another message's known match.
	for (const msg of msgs) {
		const delivery = msg.tags.msgid ? byID.get(msg.tags.msgid) : undefined;
		if (delivery) {
			delivery.matched = true;
		}
	}
	const added: Message[] = [];
	for (const msg of msgs) {
		const msgid = msg.tags.msgid;
		if (msgid) {
			if (seen.has(msgid)) {
				continue;
			}
			seen.add(msgid);
		}
		const replay = byContents
			.get(replayKey(msg))
			?.find((delivery) => !delivery.matched && (!msgid || !delivery.message.tags.msgid));
		if (replay) {
			replay.matched = true;
			continue;
		}
		added.push(msg);
	}
	if (added.length === 0) {
		return list;
	}
	// Stable: messages with the same time keep their order
	added.sort(compareMessageTime);

	if (list.length === 0) {
		return added;
	}
	if (added[added.length - 1].tags.time! <= list[0].tags.time!) {
		// Older history, fetched before the first message: it goes before
		// the messages it shares a time with
		return added.concat(list);
	}
	if (added[0].tags.time! >= list[list.length - 1].tags.time!) {
		// Newer messages, e.g. the backlog: no need to merge
		return list.concat(added);
	}

	// Messages with the same time go after the ones already there, like
	// insertMessage() does
	const merged: Message[] = [];
	let i = 0;
	let j = 0;
	while (i < list.length && j < added.length) {
		if (compareMessageTime(added[j], list[i]) < 0) {
			merged.push(added[j++]);
		} else {
			merged.push(list[i++]);
		}
	}
	for (; i < list.length; i++) {
		merged.push(list[i]);
	}
	for (; j < added.length; j++) {
		merged.push(added[j]);
	}
	return merged;
}

/** The chat messages after a read receipt: how many, and the time of the first one */
export function unreadSince(
	messages: Message[],
	receipt: Receipt | null,
): { count: number; first: Date } | null {
	let count = 0;
	let first: string | undefined;
	for (const msg of messages) {
		if (
			(msg.command === "PRIVMSG" || msg.command === "NOTICE") &&
			!isMessageBeforeReceipt(msg, receipt)
		) {
			count++;
			first ??= msg.tags.time ?? undefined;
		}
	}
	return count > 0 && first ? { count, first: new Date(first) } : null;
}
