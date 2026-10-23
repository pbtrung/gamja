/** Sending messages and commands, replies, reactions, typing and completion. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import { ClientStatus } from "../lib/client";
import { strip as stripANSI } from "../lib/ansi";
import * as S from "../state";
import { SERVER_BUFFER, BufferType } from "../state";
import commands from "../commands";
import type AppController from "./controller";

export const messagingMethods = {
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

	/** Returns false if the command failed right away, e.g. a missing argument. */
	executeCommand(this: AppController, s: string): boolean {
		// Extra spaces after the command name don't make empty arguments
		const [, name, rest] = /^\/(\S*)\s*(.*)$/s.exec(s) ?? ["", "", ""];
		// Repeated and trailing spaces don't make empty arguments, but are
		// kept in the text of e.g. /me and /msg
		const text = rest.trimEnd();
		const args = text === "" ? [] : text.split(/ +/);

		const cmd = commands.get(name.toLowerCase());
		if (!cmd) {
			this.showError(`Unknown command "${name}" (run "/help" to get a command list)`);
			return false;
		}

		const fail = (error: unknown) => {
			console.error(`Failed to execute command "${name}":`, error);
			this.showError(error);
		};
		try {
			const result = cmd.execute(this, args, text);
			if (result instanceof Promise) {
				result.catch(fail);
			}
			return result !== false;
		} catch (error) {
			fail(error);
			return false;
		}
	},

	privmsg(this: AppController, target: string, text: string): boolean {
		return this.sendChatMessage("PRIVMSG", target, text);
	},

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
			this.update({ replyTo: null });
		}
		client.send(msg);
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

	/** Returns false if the text should stay in the composer, e.g. offline. */
	handleComposerSubmit(this: AppController, text: string): boolean {
		if (!text) {
			return true;
		}

		if (text.startsWith("//")) {
			text = text.slice(1);
		} else if (text.startsWith("/")) {
			// Commands take a single line. Keep the text to fix it on failure.
			return this.executeCommand(text.replace(/\n/g, " "));
		}
		// Trailing blank lines aren't worth sending
		text = text.replace(/\n+$/, "");
		if (!text) {
			return true;
		}

		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		if (!buf) {
			return false;
		}

		return this.privmsg(buf.name, text);
	},

	/** Run an action from the member list on the active channel. */
	handleMemberAction(this: AppController, nick: string, action: S.MemberAction): void {
		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		switch (action) {
			case "message":
				this.open(nick);
				this.setOpenPanel("memberList", false);
				return;
			case "whois":
				this.executeCommand(`/whois ${nick}`);
				if (buf) {
					this.switchBuffer({ server: buf.server, name: SERVER_BUFFER });
				}
				this.setOpenPanel("memberList", false);
				return;
			case "kick":
			case "ban":
			case "kickban": {
				const verb = { kick: "Kick", ban: "Ban", kickban: "Kick and ban" }[action];
				if (!window.confirm(`${verb} ${nick} from ${buf?.name ?? "the channel"}?`)) {
					return;
				}
				break;
			}
		}
		this.executeCommand(`/${action} ${nick}`);
	},

	autocomplete(this: AppController, prefix: string): string[] {
		function fromList(l: Iterable<string>, prefix: string): string[] {
			prefix = prefix.toLowerCase();
			const repl: string[] = [];
			for (const item of l) {
				if (item.toLowerCase().startsWith(prefix)) {
					repl.push(item);
				}
			}
			return repl;
		}

		if (prefix.startsWith("/")) {
			const repl = fromList(commands.keys(), prefix.slice(1));
			return repl.map((cmd) => "/" + cmd);
		}

		const client = this.getActiveClient();
		if (client?.isChannel(prefix)) {
			// Channels of other servers can't be referred to here
			const serverID = S.getActiveServerID(this.state);
			const chanNames: string[] = [];
			for (const buf of this.state.buffers.values()) {
				if (buf.type === BufferType.CHANNEL && buf.server === serverID) {
					chanNames.push(buf.name);
				}
			}
			return fromList(chanNames, prefix);
		}

		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		if (!buf) {
			return [];
		}
		if (buf.type === BufferType.NICK) {
			return fromList([buf.name], prefix);
		}

		// Whoever spoke last is likely who the user is answering, and the
		// user rarely wants their own nick
		const cm = client?.cm ?? irc.CaseMapping.RFC1459;
		const rank = new Map<string, number>();
		for (let i = buf.messages.length - 1; i >= 0 && rank.size < 100; i--) {
			const msg = buf.messages[i];
			if ((msg.command === "PRIVMSG" || msg.command === "NOTICE") && msg.prefix) {
				const key = cm(msg.prefix.name);
				if (!rank.has(key)) {
					rank.set(key, rank.size);
				}
			}
		}
		const rankOf = (nick: string) => {
			if (client?.isMyNick(nick)) {
				return Number.MAX_SAFE_INTEGER;
			}
			return rank.get(cm(nick)) ?? rank.size;
		};
		// Array.prototype.sort is stable: other nicks keep their order
		return fromList(buf.members.keys(), prefix).sort((a, b) => rankOf(a) - rankOf(b));
	},
};

export type MessagingMethods = typeof messagingMethods;
