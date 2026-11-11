/** Bounds and pagination for messages missed during disconnection. */
import type { Message } from "../../lib/irc";
import type Client from "../../lib/client";
import * as S from "../../state";
import { SERVER_BUFFER, ReceiptType, type Receipt } from "../../state";
import * as store from "../../store";
import type AppController from "../controller";
import { getReceipt, storeServer } from "../history";

/**
 * Fetch up to limit of the latest messages between two bounds, newest page
 * first: the server may send fewer messages per reply than asked for (its
 * CHATHISTORY limit). more is set if older messages may remain.
 */
export async function fetchLatestBetween(
	client: Client,
	target: string,
	after: S.HistoryBound,
	before: S.HistoryBound,
	limit: number,
): Promise<{ messages: Message[]; more: boolean }> {
	let messages: Message[] = [];
	for (;;) {
		// The later bound goes first: CHATHISTORY BETWEEN then returns the
		// latest messages, newest page first. The spec allows bounds in either
		// order, and soju supports it.
		const page = await client.fetchHistoryPageBetween(target, before, after, limit - messages.length);
		messages = [...page.messages, ...messages];
		if (!page.more || page.messages.length === 0 || messages.length >= limit) {
			return { messages, more: page.more };
		}
		const next = S.boundFromMessage(page.messages[0]);
		if (next.time === before.time && next.msgid === before.msgid) {
			throw new Error("History pagination did not advance");
		}
		before = next;
	}
}

export function getLatestReceipt(
	bufferStore: store.BufferStore,
	server: store.ServerRef,
	type: ReceiptType,
): Receipt | null {
	let last: Receipt | null = null;
	for (const buf of bufferStore.list(server)) {
		if (buf.name === SERVER_BUFFER) {
			continue;
		}
		const receipt = getReceipt(buf, type);
		if (S.isReceiptBefore(last, receipt)) {
			last = receipt;
		}
	}
	return last;
}

/**
 * Where to start fetching the missed messages of a target: after the last
 * delivered message, read message or loaded message, the latest of them.
 */
export function backlogStart(
	app: AppController,
	serverID: number,
	client: Client,
	target: string,
	lastReceipt: Receipt,
): S.HistoryBound {
	let from: S.HistoryBound = lastReceipt;

	// Maybe we've just received a READ update from the
	// server, avoid over-fetching history
	const stored = app.bufferStore.get({ name: target, server: storeServer(client) });
	const readReceipt = getReceipt(stored, ReceiptType.READ);
	if (S.isReceiptBefore(from, readReceipt)) {
		from = readReceipt!;
	}

	// If we already have messages stored for the target,
	// fetch all messages we've missed
	const buf = S.getBuffer(app.state, { server: serverID, name: target });
	if (buf && buf.messages.length > 0) {
		const lastMsg = buf.messages[buf.messages.length - 1];
		from = S.boundFromMessage(lastMsg);
	}

	return from;
}

/** Missed messages of a buffer, loaded once it's opened */
export interface DeferredBacklog {
	from: S.HistoryBound;
	to: S.HistoryBound;
}
