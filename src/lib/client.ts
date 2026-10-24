/** The IRC client: commands on top of the connection and registration. */

import * as irc from "./irc";
import type { Message, OutgoingMessage } from "./irc";
import { IRCError } from "./client/errors";
import { RegistrationClient } from "./client/registration";
import {
	ClientStatus,
	type BatchResult,
	type BouncerNetworkAttrs,
	type ChatHistoryTarget,
} from "./client/types";
import { parseWhoReply, WHOX_FIELDS, type WhoReply, type WhoxField } from "./client/whox";

export { Backoff } from "./client/backoff";
export { IRCError } from "./client/errors";
export type { SASLOAuthBearer, SASLPlain } from "./client/sasl";
export { MULTIPLEX_CAP, type Multiplexer } from "./client/multiplex";
export { ClientStatus, type MessageEventDetail } from "./client/types";
export type { WhoxField } from "./client/whox";

let lastPing = 0;

let lastWhoxToken = 0;

export default class Client extends RegistrationClient {
	static Status = ClientStatus;

	who(mask: string, options?: { fields?: WhoxField[] }): Promise<WhoReply[]> {
		const params = [mask];

		let fields = "",
			token = "";
		if (options && this.isupport.whox()) {
			const match = ""; // Matches exact channel or nick

			fields = "t"; // Always include token in reply
			if (options.fields) {
				for (const k of options.fields) {
					if (!WHOX_FIELDS[k]) {
						throw new Error(`Unknown WHOX field ${k}`);
					}
					fields += WHOX_FIELDS[k];
				}
			}

			token = String(lastWhoxToken % 1000);
			lastWhoxToken++;

			params.push(`${match}%${fields},${token}`);
			this.whoxQueries.set(token, fields);
		}

		const msg = { command: "WHO", params };
		const l: WhoReply[] = [];
		const promise = this.pendingCmds.WHO.then(() => {
			return this.roundtrip(msg, (msg) => {
				switch (msg.command) {
					case irc.RPL_WHOREPLY:
						msg.internal = true;
						l.push(this.parseWhoReply(msg));
						break;
					case irc.RPL_WHOSPCRPL:
						if (msg.params.length !== fields.length + 1 || msg.params[1] !== token) {
							break;
						}
						msg.internal = true;
						l.push(this.parseWhoReply(msg));
						break;
					case irc.RPL_ENDOFWHO:
						if (this.cm(msg.params[1]) === this.cm(mask)) {
							msg.internal = true;
							return l;
						}
						break;
				}
			}).finally(() => {
				this.whoxQueries.delete(token);
			});
		});
		this.pendingCmds.WHO = promise.catch(() => {});
		return promise;
	}

	parseWhoReply(msg: Message): WhoReply {
		return parseWhoReply(msg, this.whoxQueries);
	}

	async whois(target: string): Promise<Record<string, Message>> {
		const targetCM = this.cm(target);
		const msg = { command: "WHOIS", params: [target] };
		const endOfWhois = await this.roundtrip(msg, (msg) => {
			let nick;
			switch (msg.command) {
				case irc.RPL_ENDOFWHOIS:
					nick = msg.params[1];
					if (this.cm(nick) === targetCM) {
						return msg;
					}
					break;
				case irc.ERR_NOSUCHNICK:
					nick = msg.params[1];
					if (this.cm(nick) === targetCM) {
						throw new IRCError(msg);
					}
					break;
			}
		});

		const whois: Record<string, Message> = {};
		for (const reply of endOfWhois.list || []) {
			whois[reply.command] = reply;
		}
		return whois;
	}

	/**
	 * Join a channel. Resolves with the name of the channel joined, which
	 * differs from the requested one when the server forwarded us elsewhere.
	 */
	async join(channel: string, password?: string): Promise<string> {
		const params = [channel];
		if (password) {
			params.push(password);
		}
		const msg = {
			command: "JOIN",
			params,
		};
		const targets = [this.cm(channel)];
		return this.roundtrip(msg, (msg) => {
			switch (msg.command) {
				case irc.ERR_LINKCHANNEL:
					// The JOIN that follows is for the channel we're forwarded to
					if (this.cm(msg.params[1]) === targets[0] && msg.params[2]) {
						targets.push(this.cm(msg.params[2]));
					}
					break;
				case irc.ERR_NOSUCHCHANNEL:
				case irc.ERR_TOOMANYCHANNELS:
				case irc.ERR_BADCHANNELKEY:
				case irc.ERR_BANNEDFROMCHAN:
				case irc.ERR_CHANNELISFULL:
				case irc.ERR_INVITEONLYCHAN:
				case irc.ERR_BADCHANMASK:
				case irc.ERR_NEEDREGGEDNICK:
					if (targets.includes(this.cm(msg.params[1]))) {
						throw new IRCError(msg);
					}
					break;
				case "JOIN":
					if (
						msg.prefix &&
						this.isMyNick(msg.prefix.name) &&
						targets.includes(this.cm(msg.params[0]))
					) {
						return msg.params[0];
					}
					break;
			}
		});
	}

	fetchBatch(msg: OutgoingMessage, batchType: string | string[]): Promise<BatchResult> {
		const batchTypes = Array.isArray(batchType) ? batchType : [batchType];
		let batchName: string | null = null;
		const messages: Message[] = [];
		return this.roundtrip(msg, (msg) => {
			for (const batch of batchName ? irc.batchAncestry(msg) : []) {
				if (batch.name === batchName) {
					messages.push(msg);
					break;
				}
			}

			if (msg.command !== "BATCH") {
				return;
			}

			const { start, name } = irc.parseBatchRef(msg);
			if (start && batchTypes.includes(msg.params[1])) {
				batchName = name;
				return;
			}
			if (!start && name === batchName) {
				return { ...this.batches.get(name)!, messages };
			}
		});
	}

	roundtripChatHistory(params: (string | number)[], batchType = "chathistory"): Promise<Message[]> {
		// Don't send multiple CHATHISTORY commands in parallel, we can't
		// properly handle batches and errors.
		const promise = this.pendingCmds.CHATHISTORY.then(async () => {
			const msg = {
				command: "CHATHISTORY",
				params,
			};
			const batch = await this.fetchBatch(msg, batchType);
			return batch.messages;
		});
		this.pendingCmds.CHATHISTORY = promise.catch(() => {});
		return promise;
	}

	/**
	 * A CHATHISTORY bound. Bounds are exclusive: use the message's ID if the
	 * server accepts it, its timestamp would skip the messages sharing it.
	 * soju only accepts timestamps (MSGREFTYPES=timestamp).
	 */
	msgRef(bound: { msgid?: string; time?: string }): string {
		if (bound.msgid && (!bound.time || this.isupport.msgRefTypes().includes("msgid"))) {
			return "msgid=" + bound.msgid;
		}
		return "timestamp=" + bound.time;
	}

	/* Fetch one page of history before the given date. */
	async fetchHistoryBefore(
		target: string,
		before: { time: string; msgid?: string },
		limit: number,
	): Promise<{ messages: Message[]; more: boolean }> {
		const max = Math.min(limit, this.isupport.chatHistory());
		const params = ["BEFORE", target, this.msgRef(before), max];
		const messages = await this.roundtripChatHistory(params);
		return { messages, more: max > 0 && messages.length >= max };
	}

	/**
	 * Fetch one page of history between two bounds, in ascending order. With
	 * the later bound first, the page holds the latest messages.
	 */
	async fetchHistoryPageBetween(
		target: string,
		from: { time: string; msgid?: string },
		to: { time: string; msgid?: string },
		limit: number,
	): Promise<{ messages: Message[]; more: boolean }> {
		const max = Math.min(limit, this.isupport.chatHistory());
		const params = ["BETWEEN", target, this.msgRef(from), this.msgRef(to), max];
		const messages = await this.roundtripChatHistory(params);
		return { messages, more: max > 0 && messages.length >= max };
	}

	async fetchHistoryTargets(t1: string, t2: string): Promise<ChatHistoryTarget[]> {
		const messages = await this.roundtripChatHistory(
			["TARGETS", "timestamp=" + t1, "timestamp=" + t2, 1000],
			"draft/chathistory-targets",
		);
		return messages.map((msg) => {
			console.assert(msg.command === "CHATHISTORY" && msg.params[0] === "TARGETS");
			return {
				name: msg.params[1],
				latestMessage: msg.params[2],
			};
		});
	}

	monitor(target: string): void {
		if (this.monitored.has(target)) {
			return;
		}

		// TODO: add poll-based fallback when MONITOR is not supported
		this.monitored.set(target, false);
		this.sendPendingMonitor();
	}

	unmonitor(target: string): void {
		const sent = this.monitored.get(target);
		if (sent === undefined) {
			return;
		}

		this.monitored.delete(target);

		if (sent) {
			this.send({ command: "MONITOR", params: ["-", target] });
			// Make use of the freed slot
			this.sendPendingMonitor();
		}
	}

	createBouncerNetwork(attrs: BouncerNetworkAttrs): Promise<string> {
		const msg = {
			command: "BOUNCER",
			params: ["ADDNETWORK", irc.formatTags(attrs)],
		};
		return this.roundtrip(msg, (msg) => {
			if (msg.command === "BOUNCER" && msg.params[0] === "ADDNETWORK") {
				return msg.params[1];
			}
		});
	}

	/**
	 * Send a command to soju's BouncerServ and return its reply. The exchange
	 * is marked internal so that it doesn't open a BouncerServ buffer.
	 */
	sendServiceCommand(text: string): Promise<string> {
		const service = "BouncerServ";
		const msg = { command: "PRIVMSG", params: [service, text] };
		return this.roundtrip(msg, (msg) => {
			if (msg.command !== "PRIVMSG" && msg.command !== "NOTICE") {
				return;
			}
			const from = msg.prefix?.name ?? "";
			const isEcho = this.isMyNick(from) && this.cm(msg.params[0]) === this.cm(service);
			const isReply = this.cm(from) === this.cm(service) && this.isMyNick(msg.params[0]);
			if (!isEcho && !isReply) {
				return;
			}
			// Part of this exchange, not a conversation to show
			msg.internal = true;
			if (isReply) {
				const reply = msg.params[1] ?? "";
				if (/^error\b/i.test(reply)) {
					throw new Error(reply);
				}
				return reply;
			}
		});
	}

	/** Subscribe to soju's per-target metadata (pinned, muted, blocked). */
	subscribeTargetMetadata(keys: string[]): void {
		this.send({ command: "METADATA", params: ["*", "SUB", ...keys] });
	}

	/** Set or clear a boolean metadata key of a target, synced to all clients. */
	setTargetMetadata(target: string, key: string, value: boolean): void {
		this.send({ command: "METADATA", params: [target, "SET", key, value ? "1" : "0"] });
	}

	/** Change a bouncer network's attributes, rejects with soju's error. */
	changeBouncerNetwork(id: string, attrs: BouncerNetworkAttrs): Promise<void> {
		return this.roundtripSubcommand("BOUNCER", ["CHANGENETWORK", id, irc.formatTags(attrs)]);
	}

	deleteBouncerNetwork(id: string): Promise<void> {
		return this.roundtripSubcommand("BOUNCER", ["DELNETWORK", id]);
	}

	/**
	 * Send a command with a subcommand and an ID, e.g. BOUNCER DELNETWORK
	 * <id>, the server replies with the same three words on success.
	 */
	async roundtripSubcommand(command: string, params: [string, string, ...string[]]): Promise<void> {
		const [subCmd, id] = params;
		await this.roundtrip({ command, params }, (msg) => {
			return msg.command === command && msg.params[0] === subCmd && msg.params[1] === id;
		});
	}

	supportsReadMarker(): boolean {
		return this.caps.enabled.has("draft/read-marker");
	}

	fetchReadMarker(target: string): void {
		this.send({
			command: "MARKREAD",
			params: [target],
		});
	}

	setReadMarker(target: string, t: string): void {
		this.send({
			command: "MARKREAD",
			params: [target, "timestamp=" + t],
		});
	}

	/** Whether the server omits NAMES replies after JOIN. */
	hasNoImplicitNames(): boolean {
		return (
			this.caps.enabled.has("draft/no-implicit-names") ||
			this.caps.enabled.has("soju.im/no-implicit-names")
		);
	}

	/** Request the member list of a channel. */
	names(channel: string): Promise<Message> {
		return this.roundtrip({ command: "NAMES", params: [channel] }, (msg) => {
			if (msg.command === irc.RPL_ENDOFNAMES && this.cm(msg.params[1]) === this.cm(channel)) {
				return msg;
			}
		});
	}

	/* Fetch messages around a message ID or timestamp. */
	async fetchHistoryAround(
		target: string,
		bound: { msgid?: string; time?: string },
		limit: number,
	): Promise<Message[]> {
		const max = Math.min(limit, this.isupport.chatHistory());
		return this.roundtripChatHistory(["AROUND", target, this.msgRef(bound), max]);
	}

	/** Run a server-side message search (soju.im/search). */
	async search(query: {
		text?: string;
		in?: string;
		from?: string;
		before?: string;
		after?: string;
		limit?: number;
	}): Promise<Message[]> {
		const attrs: irc.Tags = {};
		for (const [k, v] of Object.entries(query)) {
			if (v !== undefined && v !== null && v !== "") {
				attrs[k] = String(v);
			}
		}
		const msg = { command: "SEARCH", params: [irc.formatTags(attrs)] };
		const batch = await this.fetchBatch(msg, ["soju.im/search", "search"]);
		return batch.messages;
	}

	supportsWebPush(): boolean {
		return this.caps.enabled.has("soju.im/webpush") && Boolean(this.isupport.vapid());
	}

	/** Subscribe to Web Push notifications (soju.im/webpush). */
	registerWebPush(endpoint: string, keys: Record<string, string>): Promise<void> {
		return this.roundtripSubcommand("WEBPUSH", ["REGISTER", endpoint, irc.formatTags(keys)]);
	}

	unregisterWebPush(endpoint: string): Promise<void> {
		return this.roundtripSubcommand("WEBPUSH", ["UNREGISTER", endpoint]);
	}

	async ping(): Promise<void> {
		lastPing++;
		const token = "gamja-" + String(lastPing);
		await this.roundtrip({ command: "PING", params: [token] }, (msg) => {
			return msg.command === "PONG" && msg.params[1] === token;
		});
	}
}
