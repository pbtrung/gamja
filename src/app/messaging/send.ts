/** Sending chat messages, preserving reply state until delivery succeeds. */
import * as irc from "../../lib/irc";
import type { Message } from "../../lib/irc";
import * as S from "../../state";
import { SERVER_BUFFER } from "../../state";
import type AppController from "../controller";

export const sendMethods = {
	privmsg(this: AppController, target: string, text: string): boolean {
		return this.sendChatMessage("PRIVMSG", target, text);
	},

	/** Send a PRIVMSG or NOTICE, and show it if the server won't echo it.
	 * Returns false if it couldn't be sent. */
	sendChatMessage(
		this: AppController,
		command: "PRIVMSG" | "NOTICE",
		target: string,
		text: string,
	): boolean {
		if (target === SERVER_BUFFER) {
			this.showError("Cannot send message in server buffer");
			return false;
		}

		const serverID = S.getActiveServerID(this.state);
		// Before clearing the reply, so that it's kept for a retry
		const client = this.getConnectedClient(serverID);
		if (!client || !serverID) {
			return false;
		}

		if (!text.includes("\n")) {
			// Lines of multiline text are split to fit instead
			const maxLen = irc.getMaxPrivmsgLen(client.isupport, client.nick ?? "", target);
			const len = irc.byteLength(text);
			if (len > maxLen) {
				this.showError(`Message too long: ${len} bytes, the server accepts up to ${maxLen}`);
				return false;
			}
		}

		const msg: Message = { tags: {}, prefix: null, command, params: [target, text] };
		const replyTo = this.state.replyTo;
		const buf = S.getBuffer(this.state, { server: serverID, name: target });
		if (replyTo && buf && replyTo.buffer === buf.id) {
			if (this.canSendClientTag(client, "draft/reply")) {
				msg.tags["+draft/reply"] = replyTo.msgid;
			}
		}
		try {
			client.send(msg);
		} catch (err) {
			this.showError(err);
			return false;
		}
		if (replyTo && buf && replyTo.buffer === buf.id) {
			this.update({ replyTo: null });
		}
		if (this.typingState.buffer === buf?.id) {
			// Sending a message implicitly ends typing
			this.typingState = { buffer: null, lastSent: 0, status: "done" };
		}

		if (!client.caps.enabled.has("echo-message")) {
			// Show it where the server's echo would have gone
			msg.prefix = { name: client.nick ?? "" };
			for (const bufName of this.routeMessage(serverID, msg)) {
				this.handleChatMessage(serverID, bufName, msg);
			}
		}
		return true;
	},
};
