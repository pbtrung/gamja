/** Unread snapshots and locally inferred unread state. */
import type Client from "../../lib/client";
import type { ChatHistoryTarget } from "../../lib/client/types";
import * as S from "../../state";
import { ReceiptType, Unread } from "../../state";
import type AppController from "../controller";
import { getReceipt, storeServer } from "../history";
import { loadedUnreadAfterReceipt } from "../read";

export const unreadMethods = {
	/** Replace the snapshot's state, retaining newer live messages and read markers. */
	applyUnreadSnapshot(
		this: AppController,
		id: number,
		client: Client,
		target: ChatHistoryTarget,
		level: Unread,
	): void {
		const buf = S.getBuffer(this.state, id)!;
		const stored = this.bufferStore.get({ name: buf.name, server: storeServer(client) });
		const read = getReceipt(stored, ReceiptType.READ);
		if (read && read.time >= target.latestMessage) {
			level = Unread.NONE;
		}
		const after = read && read.time > target.latestMessage ? read : { time: target.latestMessage };
		const liveUnread = loadedUnreadAfterReceipt(this, buf.server, client, buf, after);
		const unread = S.unionUnread(level, liveUnread);
		this.setBufferState(id, {
			unread,
			unreadSnapshot: level === Unread.NONE ? null : { latestMessage: target.latestMessage, level },
		});
		this.bufferStore.put({ name: buf.name, server: storeServer(client), unread });
		this.updateDocumentTitle();
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
};
