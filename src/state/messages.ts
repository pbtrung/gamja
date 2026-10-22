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
	if (!msg.tags.time) {
		throw new Error("Missing time message tag");
	}
	if (!receipt.time) {
		throw new Error("Missing receipt time");
	}
	return msg.tags.time <= receipt.time;
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
	const time = msg.tags.time!;
	const insertBefore = upperBound(list, time);

	// Skip duplicates, e.g. when history overlaps with live messages. Only
	// messages with the same time can be duplicates.
	const msgid = msg.tags.msgid;
	for (let i = insertBefore - 1; msgid && i >= 0 && list[i].tags.time === time; i--) {
		if (list[i].tags.msgid === msgid) {
			return list;
		}
	}

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

/**
 * Merge messages, e.g. a page of history, into an immutable list of sorted
 * messages, skipping duplicates.
 */
export function mergeMessages(list: Message[], msgs: Message[]): Message[] {
	const seen = new Set<string>();
	for (const msg of list) {
		if (msg.tags.msgid) {
			seen.add(msg.tags.msgid);
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
