/** Sending messages and commands, replies, reactions, typing and completion. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import { ClientStatus } from "../lib/client";
import { strip as stripANSI } from "../lib/ansi";
import * as S from "../state";
import { BufferType } from "../state";
import type AppController from "./controller";

import { sendMethods } from "./messaging/send";
import { composerMethods } from "./messaging/composer";

export const messagingMethods = {
	...sendMethods,
	...composerMethods,
	/** Handle client-only tags: reactions and typing notifications. */
	handleTagMessage(this: AppController, serverID: number, msg: Message): void {
		const client = this.clients.get(serverID);
		if (!client || !msg.prefix) {
			return;
		}
		const from = msg.prefix.name;
		const target = this.resolveMessageTarget(serverID, msg);
		const buf = S.getBuffer(this.state, { server: serverID, name: target });
		if (!buf) {
			return;
		}

		const replyTo = msg.tags["+draft/reply"];
		const react = msg.tags["+draft/react"];
		const unreact = msg.tags["+draft/unreact"];
		if (replyTo && (react || unreact)) {
			this.setBufferState(buf.id, (b) =>
				S.applyReaction(b, replyTo, (react || unreact)!, from, Boolean(react), client.cm),
			);
		}

		const typing = msg.tags["+typing"];
		if (typing && !client.isMyNick(from) && !irc.findBatchByType(msg, "chathistory")) {
			this.setBufferState(buf.id, (b) => S.applyTyping(b, from, typing, client.cm));
		}
	},

	/** Whether the server relays a client-only tag (without the "+" prefix). */
	canSendClientTag(this: AppController, client: Client | undefined, tag: string): boolean {
		return (
			Boolean(client?.caps.enabled.has("message-tags")) && irc.isClientTagAllowed(client!.isupport, tag)
		);
	},

	canReact(this: AppController, serverID: number): boolean {
		return Boolean(this.state.servers.get(serverID)?.features.reactions);
	},

	canReply(this: AppController, serverID: number): boolean {
		return Boolean(this.state.servers.get(serverID)?.features.replies);
	},

	canRedact(this: AppController, serverID: number): boolean {
		return Boolean(this.state.servers.get(serverID)?.features.redaction);
	},

	/** Toggle a reaction on a message. */
	react(this: AppController, bufID: number, msg: Message, emoji: string): void {
		const buf = S.getBuffer(this.state, bufID);
		const msgid = msg.tags.msgid;
		if (!buf || !msgid) {
			return;
		}
		const client = this.getConnectedClient(buf.server);
		if (!client?.nick) {
			return;
		}
		const nicks = buf.reactions.get(msgid)?.get(emoji) ?? [];
		const remove = nicks.some((n) => client.isMyNick(n));
		const tag = remove ? "+draft/unreact" : "+draft/react";
		client.send({ command: "TAGMSG", params: [buf.name], tags: { [tag]: emoji, "+draft/reply": msgid } });
		if (!client.caps.enabled.has("echo-message")) {
			this.setBufferState(buf.id, (b) =>
				S.applyReaction(b, msgid, emoji, client.nick!, !remove, client.cm),
			);
		}
	},

	startReply(this: AppController, bufID: number, msg: Message): void {
		if (!msg.tags.msgid) {
			return;
		}
		const text = irc.parseCTCP(msg)?.param ?? msg.params[1] ?? "";
		this.update({
			replyTo: {
				buffer: bufID,
				msgid: msg.tags.msgid,
				nick: msg.prefix?.name ?? "*",
				text: stripANSI(text),
			},
		});
		this.ui.focusComposer?.();
	},

	cancelReply(this: AppController): void {
		this.update({ replyTo: null });
	},

	/** Delete a message (draft/message-redaction). */
	redact(this: AppController, bufID: number, msg: Message, reason?: string): void {
		const buf = S.getBuffer(this.state, bufID);
		if (!buf || !msg.tags.msgid) {
			return;
		}
		const client = this.getConnectedClient(buf.server);
		if (!client) {
			return;
		}
		const params = [buf.name, msg.tags.msgid];
		if (reason) {
			params.push(reason);
		}
		client.send({ command: "REDACT", params });
	},

	/** Notify the server of the composer state, throttled per the +typing spec. */
	notifyTyping(this: AppController, text: string): void {
		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		if (!buf || buf.type === BufferType.SERVER || text.startsWith("/")) {
			return;
		}
		// With the setting off, only end typing started before it was
		// turned off
		if (!this.state.settings.sendTyping) {
			if (this.typingState.status !== "active") {
				return;
			}
			text = "";
		}
		const client = this.clients.get(buf.server);
		if (
			!client ||
			client.status !== ClientStatus.REGISTERED ||
			!this.canSendClientTag(client, "typing")
		) {
			return;
		}

		const status = text ? "active" : "done";
		const now = Date.now();
		const prev = this.typingState;
		if (
			prev.buffer === buf.id &&
			prev.status === status &&
			(status === "done" || now - prev.lastSent < 3000)
		) {
			return;
		}
		if (status === "done" && (prev.buffer !== buf.id || prev.status === "done")) {
			return;
		}
		this.typingState = { buffer: buf.id, lastSent: now, status };
		client.send({ command: "TAGMSG", params: [buf.name], tags: { "+typing": status } });
	},
};

export type MessagingMethods = typeof messagingMethods;
