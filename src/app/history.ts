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
function storeOlderReceipts(app: AppController, client: Client, buf: Buffer, msg: Message): void {
	const receipts: store.Receipts = { [ReceiptType.DELIVERED]: S.receiptFromMessage(msg) };
	if (app.state.activeBuffer === buf.id) {
		receipts[ReceiptType.READ] = S.receiptFromMessage(msg);
	}
	app.storeReceipts(client, { name: buf.name, server: storeServer(client), receipts });
	app.setBufferState(buf.id, ({ prevReadReceipt }) => {
		if (!S.isMessageBeforeReceipt(msg, prevReadReceipt)) {
			prevReadReceipt = S.receiptFromMessage(msg);
		}
		return { prevReadReceipt };
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
		this.setBufferState(buf.id, (b) => S.trimMessages(b, Boolean(refetchable)));
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

		const first = buf.messages[0];
		const before = {
			time: first?.tags.time ?? latestHistoryBound(),
			msgid: first?.tags.msgid ?? undefined,
		};

		// Avoids sending multiple CHATHISTORY commands in parallel
		this.setBufferState(buf.id, { history: "loading" });
		const isClosed = () => this.clients.get(buf.server) !== client || !S.getBuffer(this.state, buf.id);

		let limit = 100;
		if (client.caps.enabled.has("draft/event-playback")) {
			limit = 200;
		}

		let result;
		try {
			result = await client.fetchHistoryBefore(buf.name, before, limit);
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
		this.setBufferState(buf.id, { history: result.more ? "more" : "end" });

		if (result.messages.length > 0) {
			storeOlderReceipts(this, client, buf, result.messages[result.messages.length - 1]);
		}

		this.applyHistory(buf.server, result.messages);
	},
};

export type HistoryMethods = typeof historyMethods;
