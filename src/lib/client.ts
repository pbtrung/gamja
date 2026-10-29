/**
 * The IRC client: commands on top of the connection and registration.
 *
 * Layered as ClientConnection (connection.ts), RegistrationClient
 * (registration.ts), QueryClient (queries.ts), HistoryClient (history.ts),
 * then the commands below: MONITOR, bouncer networks, metadata, read markers
 * and Web Push.
 */

import * as irc from "./irc";
import { HistoryClient } from "./client/history";
import { ClientStatus, type BouncerNetworkAttrs } from "./client/types";

export { Backoff } from "./client/backoff";
export { IRCError } from "./client/errors";
export type { SASLOAuthBearer, SASLPlain } from "./client/sasl";
export { MULTIPLEX_CAP, type Multiplexer } from "./client/multiplex";
export { ClientStatus, type MessageEventDetail } from "./client/types";
export type { WhoxField } from "./client/whox";

export default class Client extends HistoryClient {
	static Status = ClientStatus;

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
}
