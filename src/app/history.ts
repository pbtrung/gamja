/** Chat history: applying pages of history, and loading older messages. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import { ClientStatus } from "../lib/client";
import * as S from "../state";
import { BufferType, ReceiptType, type Buffer, type BufferID, type Receipt } from "../state";
import * as store from "../store";
import type AppController from "./controller";

/** How far ahead of ours the IRC server's clock may be, in milliseconds */
const MAX_CLOCK_SKEW = 24 * 60 * 60 * 1000;

/**
 * An upper bound for history queries which must include the latest messages.
 * Messages carry the IRC server's time: if its clock is ahead of ours, the
 * latest ones are in our future.
 */
export function latestHistoryBound(): string {
	return irc.formatDate(new Date(Date.now() + MAX_CLOCK_SKEW));
}

/** The server of a client, to store its buffers. */
export function storeServer(client: Client): store.ServerRef {
	return { url: client.params.url, bouncerNetwork: client.params.bouncerNetwork, cm: client.cm };
}

export function getReceipt(stored: store.StoredBuffer | undefined, type: ReceiptType): Receipt | null {
	return stored?.receipts?.[type] ?? null;
}

/** Whether a client can load older messages: CHATHISTORY with server-time. */
function canFetchHistory(client: Client | undefined): client is Client {
	return (
		!!client &&
		client.status === ClientStatus.REGISTERED &&
		client.caps.enabled.has("draft/chathistory") &&
		client.caps.enabled.has("server-time")
	);
}

/** Store the receipts of the latest message of a page of older messages. */
function storeOlderReceipts(app: AppController, client: Client, buf: Buffer, msgs: Message[]): void {
	const msg = msgs[msgs.length - 1];
	const receipts: store.Receipts = { [ReceiptType.DELIVERED]: S.receiptFromMessage(msg) };
	if (app.state.activeBuffer === buf.id && app.scrolledToLatest) {
		const latest = buf.messages.at(-1);
		receipts[ReceiptType.READ] = S.receiptFromMessage(
			latest && latest.tags.time! > msg.tags.time! ? latest : msg,
		);
	}
	app.storeReceipts(client, { name: buf.name, server: storeServer(client), receipts });
	// Older history must not move the separator captured when the buffer
	// was opened. The first history request can finish after missed messages
	// have arrived, which would otherwise make their banner disappear.
	// With no read marker or server unread state, treat the initial history
	// as already seen rather than labelling the whole page as new.
	app.setBufferState(buf.id, (b) => {
		const unread = S.unreadSince(b.messages, null);
		if (
			!b.prevReadReceipt &&
			!buf.unreadSnapshot &&
			!b.unreadSnapshot &&
			(!unread || new Date(msg.tags.time!).getTime() < unread.first.getTime())
		) {
			return { prevReadReceipt: S.receiptFromMessage(msg) };
		}
	});
}

/** Changes gathered while handling a page of history, applied at once */
export interface HistoryBatch {
	/** Messages to add, by buffer ID */
	messages: Map<number, Message[]>;
	/** Last read marker update to send, by case-mapped buffer name */
	readMarkers: Map<string, store.BufferUpdate>;
}

export const historyMethods = {
	queueHistoryMessage(this: AppController, batch: HistoryBatch, bufID: BufferID, msg: Message): void {
		// Like addMessage(), skip buffers which don't exist (yet)
		const id = S.getBuffer(this.state, bufID)?.id;
		if (id === undefined) {
			return;
		}
		const messages = batch.messages.get(id);
		if (messages) {
			messages.push(msg);
		} else {
			batch.messages.set(id, [msg]);
		}
	},

	/**
	 * Drop the oldest messages of a long buffer, unless the user is reading
	 * them: in the active buffer, scrolled up.
	 */
	trimBuffer(this: AppController, id: BufferID): void {
		const buf = S.getBuffer(this.state, id);
		if (!buf || buf.messages.length <= S.MAX_MESSAGES) {
			return;
		}
		if (buf.id === this.state.activeBuffer && !this.scrolledToLatest) {
			return;
		}
		const client = this.clients.get(buf.server);
		const refetchable =
			client?.caps.enabled.has("draft/chathistory") &&
			client.caps.enabled.has("server-time") &&
			client.isupport.chatHistory() > 0;
		this.setBufferState(buf.id, (b) =>
			S.trimMessages(b, Boolean(refetchable), S.historyLimit(this.state.settings)),
		);
	},

	/**
	 * Show a page of chat history, with one state update per buffer. Live
	 * history, missed while disconnected, is handled like new messages: it
	 * marks buffers unread and notifies.
	 */
	applyHistory(this: AppController, serverID: number, msgs: Message[], { live = false } = {}): void {
		const client = this.clients.get(serverID);
		if (!client) {
			return;
		}

		const batch: HistoryBatch = { messages: new Map(), readMarkers: new Map() };
		for (const msg of msgs) {
			if (msg.command === "TAGMSG") {
				this.handleTagMessage(serverID, msg);
				continue;
			}
			if (msg.command === "REDACT") {
				// Not displayed, but hides the message, even one loaded later.
				// Other state, e.g. members, isn't replayed from history.
				this.update((state) => S.handleRedact(state, msg, serverID, client));
				continue;
			}
			const destBuffers = this.routeMessage(serverID, msg);
			if (live) {
				for (const bufName of destBuffers) {
					this.handleChatMessage(serverID, bufName, msg, batch);
				}
				continue;
			}
			this.prepareChatMessage(serverID, msg);
			for (const bufName of destBuffers) {
				this.queueHistoryMessage(batch, { server: serverID, name: bufName }, msg);
			}
		}

		for (const [id, messages] of batch.messages) {
			this.update((state) => S.addMessages(state, messages, id));
			this.trimBuffer(id);
		}
		for (const update of batch.readMarkers.values()) {
			this.sendReadReceipt(client, update);
		}
	},

	/** Load a page of older messages in the active buffer. */
	async fetchOlderMessages(this: AppController, retry = false): Promise<void> {
		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		if (!buf || buf.type === BufferType.SERVER) {
			return;
		}

		const client = this.clients.get(buf.server);
		if (!canFetchHistory(client)) {
			return;
		}
		if (this.loadingBacklogs.has(buf.id)) {
			return;
		}
		if (buf.gap) {
			if (buf.gap.status !== "error" || retry) {
				await this.fetchMissedMessages(buf.id);
			}
			return;
		}
		if (client.isupport.chatHistory() === 0) {
			// soju doesn't advertise CHATHISTORY on the bouncer connection (e.g.
			// for BouncerServ), there is no history to load there. Elsewhere,
			// ISUPPORT may just not have arrived yet.
			const isBouncerConn =
				client.caps.enabled.has("soju.im/bouncer-networks") && !client.params.bouncerNetwork;
			if (isBouncerConn && buf.history !== "end") {
				this.setBufferState(buf.id, { history: "end" });
			}
			return;
		}
		if (buf.history === "loading" || buf.history === "end" || (buf.history === "error" && !retry)) {
			return;
		}
		const capacity = S.historyLimit(this.state.settings) - buf.messages.length;
		if (capacity <= 0) {
			if (buf.history !== "limited") {
				this.setBufferState(buf.id, { history: "limited" });
			}
			return;
		}

		const first = buf.messages[0];
		let before: S.HistoryBound = {
			time: first?.tags.time ?? latestHistoryBound(),
			msgid: first?.tags.msgid ?? undefined,
		};

		// Avoids sending multiple CHATHISTORY commands in parallel
		this.setBufferState(buf.id, { history: "loading" });
		const isClosed = () => this.clients.get(buf.server) !== client || !S.getBuffer(this.state, buf.id);

		const limit = Math.min(S.backlogSize(this.state.settings), capacity);
		const messages: Message[] = [];
		let more = true;
		try {
			while (messages.length < limit) {
				const page = await client.fetchHistoryBefore(buf.name, before, limit - messages.length);
				if (isClosed()) {
					return;
				}
				messages.unshift(...page.messages);
				more = page.more;
				if (!more || page.messages.length === 0 || messages.length >= limit) {
					break;
				}
				const next = S.boundFromMessage(page.messages[0]);
				if (next.time === before.time && next.msgid === before.msgid) {
					throw new Error("History pagination did not advance");
				}
				before = next;
			}
		} catch (err) {
			if (isClosed()) {
				return;
			}
			if (client.status !== ClientStatus.REGISTERED) {
				// Interrupted by a disconnection, not an error: fetch again
				// once reconnected
				this.setBufferState(buf.id, { history: buf.history });
				return;
			}
			// Don't retry automatically, the user can retry from the UI
			this.setBufferState(buf.id, { history: "error" });
			throw err;
		}
		if (isClosed()) {
			return;
		}
		if (messages.length > 0) {
			storeOlderReceipts(this, client, S.getBuffer(this.state, buf.id)!, messages);
		}
		this.applyHistory(buf.server, messages);
		const loaded = S.getBuffer(this.state, buf.id)!.messages.length;
		this.setBufferState(buf.id, {
			history: !more ? "end" : loaded >= S.historyLimit(this.state.settings) ? "limited" : "more",
		});
		this.fetchDeferredBacklog(buf.id);
	},
};

export type HistoryMethods = typeof historyMethods;
