/** State updates from messages about users: their nick, host, account... */

import * as irc from "../lib/irc";
import type Client from "../lib/client";
import type { User } from "./model";
import { updateServer } from "./buffers";
import { renameMember } from "./members";
import { applyUpdate, getPrefix, updateUser, type MessageHandler } from "./handle-common";

/** The user described by a WHO reply. */
function parseWhoUser(client: Client, reply: irc.Message): User {
	const who = client.parseWhoReply(reply);
	const user: User = {
		nick: who.nick,
		username: who.username,
		hostname: who.hostname,
		realname: who.realname,
		offline: false,
	};
	if (who.account !== undefined) {
		user.account = who.account;
	}

	if (who.flags !== undefined) {
		user.away = who.flags.indexOf("G") >= 0; // H for here, G for gone
		user.operator = who.flags.indexOf("*") >= 0;
		const botFlag = client.isupport.bot();
		if (botFlag) {
			user.bot = who.flags.indexOf(botFlag) >= 0;
		}
	}
	return user;
}

const handleEndOfWho: MessageHandler = (state, msg, serverID, client) => {
	const target = msg.params[1] ?? "";
	const list = msg.list || [];
	if (list.length === 0 && target && !client.isChannel(target) && target.indexOf("*") < 0) {
		// Not a channel nor a mask, likely a nick
		return updateUser(state, serverID, target, { offline: true });
	}
	return updateServer(state, serverID, (server) => {
		const users = new irc.CaseMapMap(server.users);
		for (const reply of list) {
			const user = parseWhoUser(client, reply);
			users.set(user.nick, { ...users.get(user.nick), ...user });
		}
		return { users };
	});
};

const handleQuit: MessageHandler = (state, msg, serverID) => {
	const prefix = getPrefix(msg);
	state = renameMember(state, serverID, prefix.name, null);

	return applyUpdate(
		state,
		updateServer(state, serverID, (server) => {
			const user = server.users.get(prefix.name);
			if (!user) {
				return;
			}
			const users = new irc.CaseMapMap(server.users);
			users.set(prefix.name, { ...user, offline: true });
			return { users };
		}),
	);
};

const handleNick: MessageHandler = (state, msg, serverID, client) => {
	const prefix = getPrefix(msg);
	const newNick = msg.params[0];
	if (client.isMyNick(prefix.name) || client.isMyNick(newNick)) {
		state = applyUpdate(state, updateServer(state, serverID, { nick: newNick }));
	}

	state = renameMember(state, serverID, prefix.name, newNick);

	return applyUpdate(
		state,
		updateServer(state, serverID, (server) => {
			const users = new irc.CaseMapMap(server.users);
			const user = users.get(prefix.name);
			if (!user) {
				return;
			}
			users.delete(prefix.name);
			users.set(newNick, { ...user, nick: newNick });
			return { users };
		}),
	);
};

const handleSetName: MessageHandler = (state, msg, serverID) => {
	return updateUser(state, serverID, getPrefix(msg).name, { realname: msg.params[0] });
};

const handleChgHost: MessageHandler = (state, msg, serverID) => {
	return updateUser(state, serverID, getPrefix(msg).name, {
		username: msg.params[0],
		hostname: msg.params[1],
	});
};

const handleAccount: MessageHandler = (state, msg, serverID) => {
	const account = msg.params[0] === "*" ? null : msg.params[0];
	return updateUser(state, serverID, getPrefix(msg).name, { account });
};

const handleAway: MessageHandler = (state, msg, serverID) => {
	const awayMessage = msg.params[0];
	return updateUser(state, serverID, getPrefix(msg).name, { away: Boolean(awayMessage) });
};

/** PRIVMSG, NOTICE and TAGMSG: learn about their sender from their tags. */
const handleChatMessage: MessageHandler = (state, msg, serverID) => {
	if (!msg.prefix?.user) {
		return;
	}
	const prefix = getPrefix(msg);
	const update: Partial<User> = {};
	const user = state.servers.get(serverID)?.users.get(prefix.name);
	// account-tag
	const account = msg.tags.account;
	if (account !== undefined && user?.account !== account) {
		update.account = account;
	}
	// Bot mode: the tag saves a WHO to find out
	if (msg.tags.bot !== undefined && !user?.bot) {
		update.bot = true;
	}
	if (Object.keys(update).length === 0) {
		return;
	}
	return updateUser(state, serverID, prefix.name, update);
};

/** RPL_MONONLINE and RPL_MONOFFLINE */
const handleMonitor: MessageHandler = (state, msg, serverID) => {
	const targets = (msg.params[1] ?? "").split(",").filter(Boolean);

	for (const t of targets) {
		const p = irc.parsePrefix(t);
		state = applyUpdate(
			state,
			updateUser(state, serverID, p.name, { offline: msg.command === irc.RPL_MONOFFLINE }),
		);
	}

	return state;
};

export const userHandlers = new Map<string, MessageHandler>([
	[irc.RPL_ENDOFWHO, handleEndOfWho],
	["QUIT", handleQuit],
	["NICK", handleNick],
	["SETNAME", handleSetName],
	["CHGHOST", handleChgHost],
	["ACCOUNT", handleAccount],
	["AWAY", handleAway],
	["PRIVMSG", handleChatMessage],
	["NOTICE", handleChatMessage],
	["TAGMSG", handleChatMessage],
	[irc.RPL_MONONLINE, handleMonitor],
	[irc.RPL_MONOFFLINE, handleMonitor],
]);
