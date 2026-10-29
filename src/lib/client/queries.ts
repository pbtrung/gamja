/** Commands querying the server about users and channels: WHO, WHOIS, JOIN, NAMES, PING. */

import * as irc from "../irc";
import type { Message } from "../irc";
import { IRCError } from "./errors";
import { RegistrationClient } from "./registration";
import { parseWhoReply, WHOX_FIELDS, type WhoReply, type WhoxField } from "./whox";

let lastPing = 0;

let lastWhoxToken = 0;

export abstract class QueryClient extends RegistrationClient {
	who(mask: string, options?: { fields?: WhoxField[] }): Promise<WhoReply[]> {
		const params = [mask];

		let fields = "",
			token = "";
		if (options && this.isupport.whox()) {
			({ fields, token } = this.whoxQuery(options.fields));
			const match = ""; // Matches exact channel or nick
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

	/** The WHOX fields to request, and a token to tell our replies apart. */
	whoxQuery(requested: WhoxField[] = []): { fields: string; token: string } {
		let fields = "t"; // Always include token in reply
		for (const k of requested) {
			if (!WHOX_FIELDS[k]) {
				throw new Error(`Unknown WHOX field ${k}`);
			}
			fields += WHOX_FIELDS[k];
		}

		const token = String(lastWhoxToken % 1000);
		lastWhoxToken++;
		return { fields, token };
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

	async ping(): Promise<void> {
		lastPing++;
		const token = "gamja-" + String(lastPing);
		await this.roundtrip({ command: "PING", params: [token] }, (msg) => {
			return msg.command === "PONG" && msg.params[1] === token;
		});
	}
}
