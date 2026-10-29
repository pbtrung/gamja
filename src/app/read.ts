/** Read state: unread status, receipts and read markers. */

import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import { ClientStatus } from "../lib/client";
import * as S from "../state";
import { SERVER_BUFFER, ReceiptType, Unread, type Buffer, type BufferID, type Receipt } from "../state";
import * as store from "../store";
import type AppController from "./controller";
import { getReceipt, storeServer, type HistoryBatch } from "./history";

/** Parse the read marker of a MARKREAD message, null if unset or invalid. */
function parseMarkReadBound(bound: string | undefined): Receipt | null {
	if (!bound || bound === "*" || !bound.startsWith("timestamp=")) {
		return null;
	}
	return { time: bound.replace("timestamp=", "") };
}

/** Re-compute the unread status of a buffer from its messages after a read marker. */
function unreadAfterReceipt(
	app: AppController,
	serverID: number,
	client: Client,
	buf: Buffer,
	readReceipt: Receipt,
): Unread {
	const server = app.state.servers.get(serverID);
	let unread: Unread = Unread.NONE;
	for (let i = buf.messages.length - 1; i >= 0 && unread !== Unread.HIGHLIGHT; i--) {
		const m = buf.messages[i];
		if (m.command !== "PRIVMSG" && m.command !== "NOTICE") {
			continue;
		}
		if (S.isMessageBeforeReceipt(m, readReceipt)) {
			break;
		}
		unread = S.unionUnread(unread, app.chatMessageUnread(client, server, buf.name, m));
	}
	return unread;
}

export const readMethods = {
	syncBufferUnread(this: AppController, serverID: number, name: string): void {
		const client = this.clients.get(serverID)!;

		const stored = this.bufferStore.get({ name, server: storeServer(client) });
		if (client.caps.enabled.has("draft/chathistory") && stored) {
			this.setBufferState({ server: serverID, name }, { unread: stored.unread });
			this.updateDocumentTitle();
		}

		this.bufferStore.put({
			name,
			server: storeServer(client),
			closed: false,
		});
	},

	sendReadReceipt(this: AppController, client: Client, storedBuffer: store.BufferUpdate): void {
		if (!client.supportsReadMarker() || client.status !== ClientStatus.REGISTERED) {
			return;
		}
		const readReceipt = storedBuffer.receipts?.[ReceiptType.READ];
		if (storedBuffer.name === SERVER_BUFFER || !readReceipt) {
			return;
		}
		client.setReadMarker(storedBuffer.name, readReceipt.time);
	},

	/**
	 * Store the receipts of a buffer, and send its read marker if it moved.
	 * With a batch, only the last read marker of each buffer is sent, once the
	 * whole batch is handled.
	 */
	storeReceipts(
		this: AppController,
		client: Client,
		update: store.BufferUpdate,
		batch?: HistoryBatch,
	): void {
		if (!this.bufferStore.put(update)) {
			return;
		}
		if (!batch) {
			this.sendReadReceipt(client, update);
		} else if (update.receipts?.[ReceiptType.READ]) {
			batch.readMarkers.set(client.cm(update.name), update);
		}
	},

	markBufferAsRead(this: AppController, id: BufferID): void {
		const buf = S.getBuffer(this.state, id);
		if (!buf) {
			return;
		}
		this.setBufferState(buf.id, { unread: Unread.NONE });

		const client = this.clients.get(buf.server);
		if (!client) {
			return;
		}

		this.closeNotifications(buf.server, client, buf.name);

		// Stored even without messages loaded, or the unread state would
		// come back on reload
		const update: store.BufferUpdate = {
			name: buf.name,
			server: storeServer(client),
			unread: Unread.NONE,
		};
		const lastMsg = buf.messages.at(-1);
		// Missed messages not fetched yet haven't been read
		if (lastMsg && !buf.gap) {
			update.receipts = { [ReceiptType.READ]: S.receiptFromMessage(lastMsg) };
		}
		this.storeReceipts(client, update);

		this.updateDocumentTitle();
	},

	handleMarkRead(this: AppController, serverID: number, client: Client, msg: Message): void {
		const target = msg.params[0];
		const readReceipt = parseMarkReadBound(msg.params[1]);
		if (!readReceipt) {
			return;
		}
		const stored = this.bufferStore.get({ name: target, server: storeServer(client) });
		if (S.isReceiptBefore(readReceipt, getReceipt(stored, ReceiptType.READ))) {
			return;
		}
		this.closeNotifications(serverID, client, target, readReceipt);

		const buf = S.getBuffer(this.state, { server: serverID, name: target });
		let unread: Unread = Unread.NONE;
		if (buf) {
			unread = unreadAfterReceipt(this, serverID, client, buf, readReceipt);
			this.setBufferState(buf.id, { unread });
		}

		this.bufferStore.put({
			name: target,
			server: storeServer(client),
			unread,
			closed: !buf,
			receipts: { [ReceiptType.READ]: readReceipt },
		});
		this.updateDocumentTitle();
	},
};

export type ReadMethods = typeof readMethods;
