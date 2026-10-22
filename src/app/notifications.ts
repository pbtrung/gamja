/** Unread state of new messages and desktop notifications. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import { strip as stripANSI } from "../lib/ansi";
import * as S from "../state";
import { SERVER_BUFFER, Unread, type Receipt, type Server } from "../state";
import type AppController from "./controller";

export interface MessageNotification extends Notification {
	data: { server: number; bufferName: string; message: Message };
}

function showNotification(title: string, options: NotificationOptions): MessageNotification | null {
	if (!("Notification" in globalThis) || Notification.permission !== "granted") {
		return null;
	}

	// This can still fail due to:
	// https://bugs.chromium.org/p/chromium/issues/detail?id=481856
	try {
		return new Notification(title, options) as MessageNotification;
	} catch (err) {
		console.error("Failed to show notification: ", err);
		return null;
	}
}

export const notificationsMethods = {
	/** Close the notifications of a buffer, up to a read receipt if given. */
	closeNotifications(
		this: AppController,
		serverID: number,
		client: Client,
		bufName: string,
		readReceipt?: Receipt,
	): void {
		for (const notif of this.messageNotifications) {
			if (notif.data.server !== serverID || client.cm(notif.data.bufferName) !== client.cm(bufName)) {
				continue;
			}
			if (!readReceipt || S.isMessageBeforeReceipt(notif.data.message, readReceipt)) {
				notif.close();
			}
		}
	},

	chatMessageUnread(
		this: AppController,
		client: Client,
		server: Server | undefined,
		bufName: string,
		msg: Message,
	): Unread {
		const from = msg.prefix?.name ?? "*";
		if (client.isMyNick(from) || S.getTargetMetadata(server, from).blocked) {
			return Unread.NONE;
		}
		if (S.getTargetMetadata(server, bufName).muted) {
			return Unread.MESSAGE;
		}
		const isPrivate = bufName !== SERVER_BUFFER && !client.isChannel(bufName);
		if (msg.isHighlight || isPrivate || client.isMyNick(msg.params[0])) {
			return Unread.HIGHLIGHT;
		}
		return Unread.MESSAGE;
	},

	/** Whether the user is looking at a buffer right now. */
	isBufferVisible(this: AppController, id: number): boolean {
		return this.state.activeBuffer === id && document.hasFocus() && document.visibilityState !== "hidden";
	},

	/** Show a desktop notification for a new PRIVMSG or NOTICE, if enabled. */
	notifyChatMessage(
		this: AppController,
		serverID: number,
		bufName: string,
		msg: Message,
		unread: Unread,
	): void {
		const client = this.clients.get(serverID)!;
		const muted = S.getTargetMetadata(this.state.servers.get(serverID), bufName).muted;
		const level = this.state.settings.notifications;
		const notify = level === "all" ? !muted : level === "mentions" && unread === Unread.HIGHLIGHT;
		// Actions (/me) are messages, other CTCPs aren't
		const ctcp = irc.parseCTCP(msg);
		if (unread === Unread.NONE || !notify || (ctcp && ctcp.command !== "ACTION")) {
			return;
		}
		const buf = S.getBuffer(this.state, { server: serverID, name: bufName });
		if (buf && this.isBufferVisible(buf.id)) {
			return; // The user is reading it already
		}

		const from = msg.prefix?.name ?? "*";
		let kind = "message";
		if (msg.isHighlight) {
			kind = "highlight";
		} else if (unread === Unread.HIGHLIGHT) {
			kind = "private message";
		}
		let title = "New " + kind + " from " + from;
		if (client.isChannel(bufName)) {
			title += " in " + bufName;
		}
		const notif = showNotification(title, {
			body: stripANSI(ctcp ? `* ${from} ${ctcp.param}` : msg.params[1]),
			requireInteraction: true,
			tag: "msg,server=" + serverID + ",from=" + from + ",to=" + bufName,
			data: { server: serverID, bufferName: bufName, message: msg },
		});
		if (notif) {
			notif.addEventListener("click", () => {
				window.focus();
				this.switchBuffer({ server: serverID, name: bufName });
			});
			notif.addEventListener("close", () => {
				this.messageNotifications.delete(notif);
			});
			this.messageNotifications.add(notif);
		}
	},

	notifyInvite(this: AppController, serverID: number, bufName: string, msg: Message): void {
		if (this.state.settings.notifications === "none") {
			return;
		}
		const from = msg.prefix?.name ?? "*";
		const channel = msg.params[1];
		const notif = showNotification("Invitation to " + channel, {
			body: from + " has invited you to " + channel,
			requireInteraction: true,
			tag: "invite,server=" + serverID + ",from=" + from + ",channel=" + channel,
		});
		notif?.addEventListener("click", () => {
			window.focus();
			this.switchBuffer({ server: serverID, name: bufName });
		});
	},
};

export type NotificationsMethods = typeof notificationsMethods;
