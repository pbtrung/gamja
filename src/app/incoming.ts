/** Incoming messages: dispatching them, and showing chat messages in buffers. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import * as S from "../state";
import { ReceiptType, Unread, type Buffer, type Server } from "../state";
import * as store from "../store";
import { splitHostPort } from "./config";
import type AppController from "./controller";
import { getReceipt, storeServer, type HistoryBatch } from "./history";

/** Whether a message belongs to a batch of history, handled by the caller. */
function isHistoryBatchMessage(msg: Message): boolean {
	return Boolean(
		irc.findBatchByType(msg, "chathistory") ||
		irc.findBatchByType(msg, "soju.im/search") ||
		irc.findBatchByType(msg, "search"),
	);
}

/** Whether an error reply should be shown to the user. */
function isShownError(msg: Message): boolean {
	// A forward (ERR_LINKCHANNEL) is followed by a JOIN elsewhere,
	// it's not a failure
	return (
		irc.isError(msg.command) &&
		msg.command !== irc.ERR_NOMOTD &&
		msg.command !== irc.ERR_LINKCHANNEL &&
		!msg.internal
	);
}

function handleJoin(app: AppController, serverID: number, client: Client, msg: Message): void {
	const from = msg.prefix?.name ?? "*";
	const channel = msg.params[0];

	if (client.isMyNick(from)) {
		app.syncBufferUnread(serverID, channel);
		const buf = S.getBuffer(app.state, { server: serverID, name: channel });
		if (buf && buf.id === app.state.activeBuffer && client.hasNoImplicitNames()) {
			app.fetchNames(buf);
		}
	}
	const switchTo = app.switchToChannel;
	if (
		switchTo &&
		client.isMyNick(from) &&
		(switchTo.server === null || switchTo.server === serverID) &&
		client.cm(channel) === client.cm(switchTo.name)
	) {
		app.switchBuffer({ server: serverID, name: channel });
		app.switchToChannel = null;
	}
}

function handleRename(app: AppController, serverID: number, client: Client, msg: Message): void {
	const [from, to] = msg.params;
	const stored = app.bufferStore.get({ name: from, server: storeServer(client) });
	if (stored) {
		app.bufferStore.delete({ name: from, server: storeServer(client) });
		app.bufferStore.put({ ...stored, name: to, server: storeServer(client) });
	}
	const buf = S.getBuffer(app.state, { server: serverID, name: to });
	if (buf && buf.id === app.state.activeBuffer) {
		app.updateWindowHash();
		app.updateDocumentTitle();
	}
}

function handleBatchEnd(app: AppController, client: Client, msg: Message): void {
	if (!msg.params[0].startsWith("-")) {
		return;
	}
	const name = msg.params[0].slice(1);
	const batch = client.batches.get(name);
	if (!batch || batch.type !== "soju.im/bouncer-networks") {
		return;
	}

	// We've received a BOUNCER NETWORK batch. If we have a URL to
	// auto-open and no existing network matches it, ask the user to
	// create a new network.
	if (
		app.autoOpenURL &&
		app.autoOpenURL.host &&
		// The URL may have a port, the networks' hosts don't
		!app.findBouncerNetIDByHost(splitHostPort(app.autoOpenURL.host).host)
	) {
		app.openURL(app.autoOpenURL);
		app.autoOpenURL = null;
	}
}

/**
 * The unread state brought by a new message, notifying it if it wasn't
 * delivered yet.
 */
function newMessageUnread(
	app: AppController,
	serverID: number,
	client: Client,
	server: Server | undefined,
	bufName: string,
	msg: Message,
): Unread {
	const stored = app.bufferStore.get({ name: bufName, server: storeServer(client) });
	let msgUnread: Unread = Unread.NONE;
	if (
		(msg.command === "PRIVMSG" || msg.command === "NOTICE") &&
		!S.isMessageBeforeReceipt(msg, getReceipt(stored, ReceiptType.READ))
	) {
		msgUnread = app.chatMessageUnread(client, server, bufName, msg);
		if (!S.isMessageBeforeReceipt(msg, getReceipt(stored, ReceiptType.DELIVERED))) {
			app.notifyChatMessage(serverID, bufName, msg, msgUnread);
		}
	}
	if (msg.command === "INVITE" && client.isMyNick(msg.params[0])) {
		msgUnread = Unread.HIGHLIGHT;
		app.notifyInvite(serverID, bufName, msg);
	}
	return msgUnread;
}

/** Whether a message opens a buffer for its target. */
function opensBuffer(msg: Message): boolean {
	return (
		msg.command !== "PART" &&
		msg.command !== "QUIT" &&
		msg.command !== irc.RPL_MONONLINE &&
		msg.command !== irc.RPL_MONOFFLINE
	);
}

/**
 * Update the unread state and receipts of a buffer for a new message: read
 * if the user sees it, unread otherwise.
 */
function updateBufferForMessage(
	app: AppController,
	client: Client,
	buf: Buffer,
	msg: Message,
	msgUnread: Unread,
	batch?: HistoryBatch,
): void {
	const from = msg.prefix?.name ?? "*";
	let unread = buf.unread;
	let prevReadReceipt = buf.prevReadReceipt;
	const receipts: store.Receipts = { [ReceiptType.DELIVERED]: S.receiptFromMessage(msg) };

	// Scrolled up, the user is reading older messages, not this one
	if (!app.isBufferVisible(buf.id) || !app.scrolledToLatest) {
		unread = S.unionUnread(unread, msgUnread);
	} else if (!buf.gap) {
		// With missed messages not fetched yet, the user hasn't read them
		receipts[ReceiptType.READ] = S.receiptFromMessage(msg);
	}

	// Don't show unread marker for my own messages
	if (client.isMyNick(from) && !S.isMessageBeforeReceipt(msg, prevReadReceipt)) {
		prevReadReceipt = S.receiptFromMessage(msg);
	}

	app.storeReceipts(client, { name: buf.name, server: storeServer(client), unread, receipts }, batch);
	if (unread !== buf.unread || prevReadReceipt !== buf.prevReadReceipt) {
		app.setBufferState(buf.id, { unread, prevReadReceipt });
	}
}

export const incomingMethods = {
	handleMessage(this: AppController, serverID: number, msg: Message): void {
		const client = this.clients.get(serverID);
		if (!client) {
			return;
		}

		if (isHistoryBatchMessage(msg)) {
			return; // Handled by the caller
		}

		const destBuffers = this.routeMessage(serverID, msg);

		try {
			this.update((state) => S.handleMessage(state, msg, serverID, client));
		} catch (err) {
			console.error("Failed to handle message:", msg, err);
		}

		switch (msg.command) {
			case irc.RPL_WELCOME:
				this.fetchBacklog(serverID).catch((err) => {
					console.error("Failed to fetch backlog:", err);
				});
				break;
			case irc.RPL_ENDOFMOTD:
			case irc.ERR_NOMOTD:
				this.handleEndOfRegistration(serverID, client);
				break;
			case "JOIN":
				handleJoin(this, serverID, client, msg);
				break;
			case "BOUNCER":
				this.handleBouncerNetwork(serverID, client, msg);
				break;
			case "RENAME":
				handleRename(this, serverID, client, msg);
				break;
			case "BATCH":
				handleBatchEnd(this, client, msg);
				break;
			case "MARKREAD":
				this.handleMarkRead(serverID, client, msg);
				break;
			case "TAGMSG":
				this.handleTagMessage(serverID, msg);
				break;
			default:
				if (isShownError(msg)) {
					const description = msg.params[msg.params.length - 1];
					this.showError(description);
				}
		}

		for (const bufName of destBuffers) {
			this.handleChatMessage(serverID, bufName, msg);
		}
	},

	prepareChatMessage(this: AppController, serverID: number, msg: Message): void {
		// Treat server-wide broadcasts as highlights. They're sent by server
		// operators and can contain important information.
		if (msg.isHighlight === undefined) {
			const client = this.clients.get(serverID);
			msg.isHighlight =
				!!client?.nick &&
				(irc.isHighlight(msg, client.nick, client.cm) || irc.isServerBroadcast(msg));
		}

		if (!msg.tags) {
			// Can happen for outgoing messages for instance
			msg.tags = {};
		}
		if (!msg.tags.time) {
			msg.tags.time = irc.formatDate(new Date());
		}
	},

	/**
	 * Show a message in a buffer, as new: it may mark the buffer unread and
	 * notify. With a batch, the message is only added once the whole batch is
	 * handled, see applyHistory().
	 */
	handleChatMessage(
		this: AppController,
		serverID: number,
		bufName: string,
		msg: Message,
		batch?: HistoryBatch,
	): void {
		const client = this.clients.get(serverID)!;

		this.prepareChatMessage(serverID, msg);

		const from = msg.prefix?.name ?? "*";
		const server = this.state.servers.get(serverID);
		if (
			S.getTargetMetadata(server, from).blocked &&
			!S.getBuffer(this.state, { server: serverID, name: bufName })
		) {
			return; // Don't open a conversation for a blocked user
		}

		const msgUnread = newMessageUnread(this, serverID, client, server, bufName, msg);

		if (opensBuffer(msg)) {
			this.createBuffer(serverID, bufName);
		}

		const bufID = { server: serverID, name: bufName };
		if (batch) {
			this.queueHistoryMessage(batch, bufID, msg);
		} else {
			this.update((state) => S.addMessage(state, msg, bufID));
			this.trimBuffer(bufID);
		}
		if (msg.command === "PRIVMSG" || msg.command === "NOTICE") {
			this.setBufferState(bufID, (b) =>
				b.typing.size > 0 ? S.applyTyping(b, from, "done", client.cm) : undefined,
			);
		}

		const buf = S.getBuffer(this.state, bufID);
		if (!buf) {
			return;
		}

		updateBufferForMessage(this, client, buf, msg, msgUnread, batch);

		if (msgUnread === Unread.HIGHLIGHT) {
			this.updateDocumentTitle();
		}
	},
};

export type IncomingMethods = typeof incomingMethods;
