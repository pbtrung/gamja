/** State updates from channel messages: topics, members and their modes. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import type { State, User } from "./model";
import { createBuffer, getBuffer, leftChannel, updateBuffer } from "./buffers";
import { sortBuffers } from "./display";
import { editMembers, updateMembership } from "./members";
import { applyUpdate, getPrefix, updateTarget, updateUser, type MessageHandler } from "./handle-common";

const handleNoTopic: MessageHandler = (state, msg, serverID) => {
	const channel = msg.params[1];
	return updateTarget(state, serverID, channel, { topic: null });
};

const handleTopicReply: MessageHandler = (state, msg, serverID) => {
	const channel = msg.params[1];
	const topic = msg.params[2];
	return updateTarget(state, serverID, channel, { topic });
};

const handleTopic: MessageHandler = (state, msg, serverID) => {
	const channel = msg.params[0];
	const topic = msg.params[1];
	return updateTarget(state, serverID, channel, { topic });
};

/** Collect the members of a NAMES reply, set at its end. */
const handleNamReply: MessageHandler = (state, msg, serverID, client) => {
	const channel = msg.params[2];
	const membershipPrefixes = client.isupport
		.membershipModes()
		.map(({ prefix }) => prefix)
		.join("");
	return updateTarget(state, serverID, channel, (buf) => {
		const pendingMembers = new irc.CaseMapMap<string>(buf.pendingMembers, buf.members.caseMap);
		for (const s of (msg.params[3] ?? "").split(" ")) {
			if (!s) {
				continue;
			}
			const member = irc.parseTargetPrefix(s, membershipPrefixes);
			// userhost-in-names
			const name = irc.parsePrefix(member.name).name;
			pendingMembers.set(name, member.prefix);
		}
		return { pendingMembers };
	});
};

const handleEndOfNames: MessageHandler = (state, msg, serverID) => {
	const channel = msg.params[1];
	return updateTarget(state, serverID, channel, (buf) => ({
		members: buf.pendingMembers ?? new irc.CaseMapMap<string>(null, buf.members.caseMap),
		pendingMembers: null,
		hasNames: true,
	}));
};

const handleJoin: MessageHandler = (state, msg, serverID, client) => {
	const prefix = getPrefix(msg);
	const channel = msg.params[0];

	if (client.isMyNick(prefix.name)) {
		const [, update] = createBuffer(state, channel, serverID, client);
		state = applyUpdate(state, update ?? undefined);
	}

	state = applyUpdate(
		state,
		updateTarget(state, serverID, channel, (buf) => {
			const joined = buf.joined || client.isMyNick(prefix.name);
			return { ...editMembers(buf, (members) => members.set(prefix.name, "")), joined };
		}),
	);

	const who: Partial<User> = { nick: prefix.name, offline: false };
	if (prefix.user) {
		who.username = prefix.user;
	}
	if (prefix.host) {
		who.hostname = prefix.host;
	}
	// extended-join
	if (msg.params.length > 2) {
		who.account = msg.params[1] === "*" ? null : msg.params[1];
		who.realname = msg.params[2];
	}
	return applyUpdate(state, updateUser(state, serverID, prefix.name, who));
};

/** PART and KICK */
const handleLeave: MessageHandler = (state, msg, serverID, client) => {
	const channel = msg.params[0];
	const nick = msg.command === "KICK" ? msg.params[1] : getPrefix(msg).name;

	return updateTarget(state, serverID, channel, (buf) => {
		if (client.isMyNick(nick)) {
			return leftChannel(buf);
		}
		return editMembers(buf, (members) => members.delete(nick));
	});
};

/** Update the membership prefixes of channel members. */
const handleMode: MessageHandler = (state, msg, serverID, client) => {
	const target = msg.params[0];

	if (!client.isChannel(target)) {
		return; // TODO: handle user mode changes too
	}

	const membershipModes = client.isupport.membershipModes();
	const prefixByMode = new Map(membershipModes.map((membership) => [membership.mode, membership.prefix]));

	return updateTarget(state, serverID, target, (buf) =>
		editMembers(buf, (members) => {
			irc.forEachChannelModeUpdate(msg, client.isupport, (mode, add, arg) => {
				const letter = prefixByMode.get(mode);
				if (letter === undefined) {
					return;
				}
				const nick = arg;
				if (!nick) {
					// Malformed, e.g. "MODE #chan +o": there's no member to update
					return;
				}
				const membership = members.get(nick);
				if (membership === undefined) {
					return;
				}
				members.set(nick, updateMembership(membership, letter, add, client));
			});
		}),
	);
};

/** draft/channel-rename */
const handleRename: MessageHandler = (state, msg, serverID) => {
	const [from, to] = msg.params;
	const buf = getBuffer(state, { server: serverID, name: from });
	if (!buf) {
		return;
	}
	const bufferList = Array.from(state.buffers.values()).map((b) =>
		b.id === buf.id ? { ...b, name: to } : b,
	);
	return { buffers: sortBuffers(state, bufferList) };
};

/**
 * Hide a message deleted by REDACT. Also used for those in chat history,
 * whose other messages don't change the state.
 */
export function handleRedact(
	state: State,
	msg: Message,
	serverID: number,
	client: Client,
): Partial<State> | undefined {
	const [rawTarget, msgid] = msg.params;
	const target = client.isMyNick(rawTarget) ? (msg.prefix?.name ?? "*") : rawTarget;
	if (!target || !msgid) {
		return;
	}
	return updateBuffer(state, { server: serverID, name: target }, (buf) => {
		return { redacted: new Set(buf.redacted).add(msgid) };
	});
}

export const channelHandlers = new Map<string, MessageHandler>([
	[irc.RPL_NOTOPIC, handleNoTopic],
	[irc.RPL_TOPIC, handleTopicReply],
	["TOPIC", handleTopic],
	[irc.RPL_NAMREPLY, handleNamReply],
	[irc.RPL_ENDOFNAMES, handleEndOfNames],
	["JOIN", handleJoin],
	["PART", handleLeave],
	["KICK", handleLeave],
	["MODE", handleMode],
	["RENAME", handleRename],
	["REDACT", handleRedact],
]);
