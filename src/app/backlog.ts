/** Backlog: messages missed while disconnected. */

import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import type { ChatHistoryTarget } from "../lib/client/types";
import { ClientStatus } from "../lib/client";
import * as S from "../state";
import { SERVER_BUFFER, ReceiptType, Unread, type BufferID, type Receipt } from "../state";
import * as store from "../store";
import type AppController from "./controller";
import { getReceipt, latestHistoryBound, storeServer } from "./history";

const CHATHISTORY_MAX_SIZE = 4000;

/**
 * Fetch up to limit of the latest messages between two bounds, newest page
 * first: the server may send fewer messages per reply than asked for (its
 * CHATHISTORY limit). more is set if older messages may remain.
 */
async function fetchLatestBetween(
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
		before = S.boundFromMessage(page.messages[0]);
	}
}

function getLatestReceipt(
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
function backlogStart(
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

/** The lower bound of CHATHISTORY TARGETS listing every target */
const HISTORY_START = "1970-01-01T00:00:00.000Z";

export const backlogMethods = {
	/**
	 * Show which buffers have missed messages and mentions, without loading
	 * them: only the active buffer's are loaded, the others' once opened.
	 * With soju.im/unread, the server tells which targets have unread
	 * messages and mentions after their read marker; otherwise targets with
	 * messages after ours are unread, and private ones mention us.
	 */
	async fetchBacklog(this: AppController, serverID: number): Promise<void> {
		const client = this.clients.get(serverID)!;
		if (!client.caps.enabled.has("draft/chathistory")) {
			return;
		}
		if (client.caps.enabled.has("soju.im/bouncer-networks") && !client.params.bouncerNetwork) {
			return;
		}

		const serverState = client.caps.enabled.has("soju.im/unread");
		const lastReceipt = getLatestReceipt(this.bufferStore, storeServer(client), ReceiptType.DELIVERED);
		if (!lastReceipt && !serverState) {
			return;
		}

		const bound = latestHistoryBound();
		// The server's state covers every target, read elsewhere or not
		const targets = await client.fetchHistoryTargets(
			bound,
			serverState ? HISTORY_START : lastReceipt!.time,
		);
		// The server may be closed while waiting for the history
		if (this.clients.get(serverID) !== client) {
			return;
		}
		await Promise.all(
			targets.map(async (target) => {
				// Query read marker if this is a user (ie, we haven't received
				// the read marker as part of a JOIN burst)
				if (client.supportsReadMarker() && client.isNick(target.name)) {
					client.fetchReadMarker(target.name);
				}

				const unread = this.targetUnread(serverID, client, target, serverState);
				let buf = S.getBuffer(this.state, { server: serverID, name: target.name });
				if (!buf && unread !== Unread.NONE && !client.isChannel(target.name)) {
					this.createBuffer(serverID, target.name);
					buf = S.getBuffer(this.state, { server: serverID, name: target.name });
				}
				if (!buf) {
					return;
				}

				// Without loaded messages, opening the buffer loads its
				// latest ones anyway
				const lastMsg = buf.messages.at(-1);
				const from = lastReceipt
					? backlogStart(this, serverID, client, target.name, lastReceipt)
					: lastMsg && S.boundFromMessage(lastMsg);
				const backlog = from && { from, to: { time: bound } };
				if (buf.id === this.state.activeBuffer) {
					if (backlog) {
						await this.fetchTargetBacklog(serverID, client, target.name, backlog);
					}
					return;
				}
				if (backlog) {
					const prev = this.deferredBacklogs.get(buf.id);
					// Missed messages of an earlier disconnection aren't fetched yet
					this.deferredBacklogs.set(buf.id, prev ? { from: prev.from, to: backlog.to } : backlog);
				}
				this.markBufferUnread(buf.id, client, unread);
			}),
		);
	},

	/** The unread state of a target listed by CHATHISTORY TARGETS. */
	targetUnread(
		this: AppController,
		serverID: number,
		client: Client,
		target: ChatHistoryTarget,
		serverState: boolean,
	): Unread {
		let unread, mention;
		if (serverState) {
			({ unread, mention } = target);
		} else {
			const stored = this.bufferStore.get({ name: target.name, server: storeServer(client) });
			const read = getReceipt(stored, ReceiptType.READ);
			unread = !read || target.latestMessage > read.time;
			mention = unread && !client.isChannel(target.name);
		}
		const server = this.state.servers.get(serverID);
		if (mention && !S.getTargetMetadata(server, target.name).muted) {
			return Unread.HIGHLIGHT;
		}
		return unread || mention ? Unread.MESSAGE : Unread.NONE;
	},

	/** Raise the unread state of a buffer, and store it. */
	markBufferUnread(this: AppController, id: number, client: Client, level: Unread): void {
		const buf = S.getBuffer(this.state, id)!;
		const unread = S.unionUnread(buf.unread, level);
		if (unread === buf.unread) {
			return;
		}
		this.setBufferState(id, { unread });
		this.bufferStore.put({ name: buf.name, server: storeServer(client), unread });
		this.updateDocumentTitle();
	},

	/**
	 * Fetch the latest missed messages of a target, as many as the
	 * backlogSize setting: older ones are fetched on demand, see
	 * fetchMissedMessages().
	 */
	async fetchTargetBacklog(
		this: AppController,
		serverID: number,
		client: Client,
		target: string,
		{ from, to }: DeferredBacklog,
	): Promise<void> {
		// The server may be closed while waiting for the history
		const isClosed = () => this.clients.get(serverID) !== client;
		// A disconnection fails the pending requests: not worth an error, the
		// backlog is fetched again once reconnected
		const isInterrupted = () => isClosed() || client.status !== ClientStatus.REGISTERED;

		let result;
		try {
			result = await fetchLatestBetween(client, target, from, to, S.backlogSize(this.state.settings));
		} catch (err) {
			if (isInterrupted()) {
				return;
			}
			console.error("Failed to fetch backlog for '" + target + "': ", err);
			this.showError("Failed to fetch backlog for '" + target + "'");
			return;
		}
		if (isClosed()) {
			return;
		}

		if (result.more && result.messages.length > 0) {
			this.markMissedMessages(serverID, target, from, result.messages);
		}
		this.applyHistory(serverID, result.messages, { live: true });
	},

	/** Fetch the missed messages left for when the buffer is opened. */
	fetchDeferredBacklog(this: AppController, id: number): void {
		const backlog = this.deferredBacklogs.get(id);
		const buf = S.getBuffer(this.state, id);
		const client = buf ? this.clients.get(buf.server) : undefined;
		if (!backlog || !buf || !client || client.status !== ClientStatus.REGISTERED) {
			return;
		}
		this.deferredBacklogs.delete(id);
		this.fetchTargetBacklog(buf.server, client, buf.name, backlog).catch((err) => {
			console.error("Failed to fetch backlog for '" + buf.name + "': ", err);
		});
	},

	/**
	 * Record that missed messages weren't all fetched: those between the
	 * last loaded message and the oldest of the fetched page. Without loaded
	 * messages, they are fetched as older history instead.
	 */
	markMissedMessages(
		this: AppController,
		serverID: number,
		bufName: string,
		after: S.HistoryBound,
		page: Message[],
	): void {
		const buf = S.getBuffer(this.state, { server: serverID, name: bufName });
		if (!buf) {
			return;
		}
		if (buf.messages.length === 0) {
			if (buf.history === "end") {
				this.setBufferState(buf.id, { history: "more" });
			}
			return;
		}
		let oldest = page[0];
		for (const msg of page) {
			if (msg.tags.time! < oldest.tags.time!) {
				oldest = msg;
			}
		}
		// Missed messages of an earlier disconnection may not be fetched yet
		this.setBufferState(buf.id, (b) => ({
			gap: { after: b.gap?.after ?? after, before: S.boundFromMessage(oldest), status: "idle" },
		}));
	},

	/** Fetch the missed messages of a buffer which weren't fetched on reconnect. */
	async fetchMissedMessages(this: AppController, id: BufferID): Promise<void> {
		const buf = S.getBuffer(this.state, id);
		const client = buf ? this.clients.get(buf.server) : undefined;
		if (
			!buf?.gap ||
			buf.gap.status === "loading" ||
			!client ||
			client.status !== ClientStatus.REGISTERED
		) {
			return;
		}
		const { before } = buf.gap;
		let { after } = buf.gap;
		const setGap = (gap: S.HistoryGap | null) => this.setBufferState(buf.id, { gap });
		const isClosed = () => this.clients.get(buf.server) !== client || !S.getBuffer(this.state, buf.id);

		setGap({ after, before, status: "loading" });
		let total = 0;
		for (;;) {
			let result;
			try {
				result = await client.fetchHistoryPageBetween(
					buf.name,
					after,
					before,
					CHATHISTORY_MAX_SIZE - total,
				);
			} catch (err) {
				if (isClosed()) {
					return;
				}
				if (client.status !== ClientStatus.REGISTERED) {
					// Interrupted by a disconnection, not an error: the user can
					// try again once reconnected
					setGap({ after, before, status: "idle" });
					return;
				}
				setGap({ after, before, status: "error" });
				throw err;
			}
			if (isClosed()) {
				return;
			}
			// Already marked delivered: no notifications
			this.applyHistory(buf.server, result.messages);
			total += result.messages.length;
			if (!result.more) {
				break;
			}
			after = S.boundFromMessage(result.messages[result.messages.length - 1]);
			if (total >= CHATHISTORY_MAX_SIZE) {
				// Let the user ask for more
				setGap({ after, before, status: "idle" });
				return;
			}
			setGap({ after, before, status: "loading" });
		}

		setGap(null);
		if (this.state.activeBuffer === buf.id) {
			this.markBufferAsRead(buf.id);
		}
	},
};

export type BacklogMethods = typeof backlogMethods;
