/** Routing of IRC messages to the buffers they're displayed in. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import * as S from "../state";
import { SERVER_BUFFER, BufferType } from "../state";
import type AppController from "./controller";

/** Messages not displayed in any buffer, see routeMessage() */
const UNDISPLAYED_COMMANDS = new Set([
	irc.RPL_YOURHOST,
	irc.RPL_MYINFO,
	irc.RPL_ISUPPORT,
	irc.RPL_ENDOFMOTD,
	irc.ERR_NOMOTD,
	irc.RPL_AWAY,
	irc.RPL_NOTOPIC,
	irc.RPL_TOPIC,
	irc.RPL_TOPICWHOTIME,
	irc.RPL_NAMREPLY,
	irc.RPL_ENDOFNAMES,
	irc.RPL_SASLSUCCESS,
	irc.RPL_CHANNEL_URL,
	"AWAY",
	"SETNAME",
	"CHGHOST",
	"ACCOUNT",
	"CAP",
	"AUTHENTICATE",
	"PING",
	"PONG",
	"BATCH",
	"TAGMSG",
	"CHATHISTORY",
	"ACK",
	"BOUNCER",
	"MARKREAD",
	"REDACT",
	"WEBPUSH",
	"METADATA",
	irc.RPL_KEYVALUE,
	irc.RPL_METADATASUBOK,
	irc.RPL_METADATAUNSUBOK,
]);

export const routingMethods = {
	/** Find the buffer name for a PRIVMSG, NOTICE or TAGMSG. */
	resolveMessageTarget(this: AppController, serverID: number, msg: Message): string {
		const client = this.clients.get(serverID)!;
		const from = msg.prefix?.name ?? "*";
		let target = msg.params[0];
		if (client.isMyNick(target)) {
			if (client.cm(from) === client.cm(client.serverPrefix.name)) {
				target = SERVER_BUFFER;
			} else {
				const context = msg.tags["+draft/channel-context"];
				if (
					context &&
					client.isChannel(context) &&
					S.getBuffer(this.state, { server: serverID, name: context })
				) {
					target = context;
				} else {
					target = from;
				}
			}
		}

		const allowedPrefixes = client.isupport.statusMsg();
		if (allowedPrefixes) {
			const parts = irc.parseTargetPrefix(target, allowedPrefixes);
			if (client.isChannel(parts.name)) {
				target = parts.name;
			}
		}
		return target;
	},

	/** Find the buffers a message should be displayed in. */
	routeMessage(this: AppController, serverID: number, msg: Message): string[] {
		const client = this.clients.get(serverID)!;
		const chatHistoryBatch = irc.findBatchByType(msg, "chathistory");
		const from = msg.prefix?.name ?? "*";

		// Internal messages are replies triggered by some command sent by us,
		// not worth displaying to the user
		if (msg.internal || UNDISPLAYED_COMMANDS.has(msg.command)) {
			return [];
		}

		let target, channel;
		switch (msg.command) {
			case "MODE":
				target = msg.params[0];
				if (client.isChannel(target)) {
					return [target];
				}
				return [SERVER_BUFFER];
			case "NOTICE":
			case "PRIVMSG": {
				target = this.resolveMessageTarget(serverID, msg);

				// Don't open a new buffer if this is just a NOTICE or a garbage
				// CTCP message
				let openNewBuffer = true;
				if (msg.command !== "PRIVMSG") {
					openNewBuffer = false;
				} else {
					const ctcp = irc.parseCTCP(msg);
					if (ctcp && ctcp.command !== "ACTION") {
						openNewBuffer = false;
					}
				}
				if (!openNewBuffer && !S.getBuffer(this.state, { server: serverID, name: target })) {
					target = SERVER_BUFFER;
				}

				return [target];
			}
			case "JOIN":
				channel = msg.params[0];
				if (!client.isMyNick(from)) {
					return [channel];
				}
				return [];
			case "PART":
			case "KICK":
			case "TOPIC":
				return [msg.params[0]];
			case "RENAME":
				return [msg.params[1]];
			case "QUIT":
			case "NICK": {
				const affectedBuffers: string[] = [];
				if (chatHistoryBatch) {
					affectedBuffers.push(chatHistoryBatch.params[0]);
				} else {
					this.state.buffers.forEach((buf) => {
						if (buf.server !== serverID) {
							return;
						}
						if (
							!buf.members.has(from) &&
							!(buf.type === BufferType.NICK && client.cm(buf.name) === client.cm(from))
						) {
							return;
						}
						affectedBuffers.push(buf.name);
					});
					if (msg.command === "NICK" && client.isMyNick(msg.params[0])) {
						affectedBuffers.push(SERVER_BUFFER);
					}
				}
				return affectedBuffers;
			}
			case "INVITE": {
				channel = msg.params[1];

				// TODO: find a more reliable way to do this
				let bufName = channel;
				if (!S.getBuffer(this.state, { server: serverID, name: channel })) {
					bufName = SERVER_BUFFER;
				}

				return [bufName];
			}
			case irc.RPL_CHANNELMODEIS:
			case irc.RPL_CREATIONTIME:
			case irc.RPL_INVITELIST:
			case irc.RPL_ENDOFINVITELIST:
			case irc.RPL_EXCEPTLIST:
			case irc.RPL_ENDOFEXCEPTLIST:
			case irc.RPL_BANLIST:
			case irc.RPL_ENDOFBANLIST:
			case irc.RPL_QUIETLIST:
			case irc.RPL_ENDOFQUIETLIST:
				return [msg.params[1]];
			case irc.RPL_INVITING:
				return [msg.params[2]];
			case irc.RPL_MONONLINE:
			case irc.RPL_MONOFFLINE:
				return msg.params[1].split(",").map((t) => irc.parsePrefix(t).name);
			default:
				return [SERVER_BUFFER];
		}
	},
};

export type RoutingMethods = typeof routingMethods;
