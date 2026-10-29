/** State updates from incoming IRC messages. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import {
	METADATA_KEYS,
	SERVER_BUFFER,
	type Buffer,
	type Features,
	type Server,
	type State,
	type TargetMetadata,
	type Updater,
	type User,
} from "./model";
import {
	createBuffer,
	getBuffer,
	leftChannel,
	updateBuffer,
	updateServer,
	updateState,
} from "./buffers";
import { sortBuffers } from "./display";

/** Rename a nick in the channels of a server, or remove it with null. */
/**
 * Change the members of a channel, and those of the NAMES reply being
 * received if any: the reply predates the change.
 */
function editMembers(
	buf: Buffer,
	edit: (members: irc.CaseMapMap<string>) => void,
): Pick<Buffer, "members" | "pendingMembers"> {
	const members = new irc.CaseMapMap(buf.members);
	edit(members);
	let pendingMembers = buf.pendingMembers;
	if (pendingMembers) {
		pendingMembers = new irc.CaseMapMap(pendingMembers);
		edit(pendingMembers);
	}
	return { members, pendingMembers };
}

function renameMember(state: State, serverID: number, nick: string, newNick: string | null): State {
	let buffers: Map<number, Buffer> | null = null;
	for (const buf of state.buffers.values()) {
		if (buf.server !== serverID || !(buf.members.has(nick) || buf.pendingMembers?.has(nick))) {
			continue;
		}
		// Only copy the buffers if a channel changes: a new map re-renders
		// everything showing buffers
		buffers ??= new Map(state.buffers);
		const update = editMembers(buf, (members) => {
			const membership = members.get(nick);
			if (membership === undefined) {
				return;
			}
			members.delete(nick);
			if (newNick !== null) {
				members.set(newNick, membership);
			}
		});
		buffers.set(buf.id, { ...buf, ...update });
	}
	return buffers ? { ...state, buffers } : state;
}

function computeFeatures(client: Pick<Client, "caps" | "isupport">): Features {
	const tags = client.caps.enabled.has("message-tags");
	return {
		reactions: tags && irc.isClientTagAllowed(client.isupport, "draft/react"),
		replies: tags && irc.isClientTagAllowed(client.isupport, "draft/reply"),
		typing: tags && irc.isClientTagAllowed(client.isupport, "typing"),
		redaction: client.caps.enabled.has("draft/message-redaction"),
		search: client.caps.enabled.has("soju.im/search"),
		webPush: client.caps.enabled.has("soju.im/webpush") && Boolean(client.isupport.vapid()),
		// soju's keys only apply to a network's targets
		targetMetadata:
			client.caps.enabled.has("draft/metadata-2") && Boolean(client.isupport.bouncerNetID()),
	};
}

function updateMembership(membership: string, letter: string, add: boolean, client: Client): string {
	const membershipModes = client.isupport.membershipModes();

	const prefixPrivs = new Map(
		membershipModes.map((membership, i) => {
			return [membership.prefix, i];
		}),
	);

	if (add) {
		const i = membership.indexOf(letter);
		if (i < 0) {
			membership += letter;
			membership = Array.from(membership)
				.sort((a, b) => {
					return (prefixPrivs.get(a) ?? 0) - (prefixPrivs.get(b) ?? 0);
				})
				.join("");
		}
	} else {
		membership = membership.replace(letter, "");
	}

	return membership;
}

/** Update the state according to an incoming IRC message. */
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

export function handleMessage(
	state: State,
	msg: Message,
	serverID: number,
	client: Client,
): Partial<State> | undefined {
	const updateServerWith = (updater: Updater<Server>) => updateServer(state, serverID, updater);
	// A missing name would select the server buffer, see getBuffer(): ignore
	// messages missing their target instead, e.g. malformed replies
	const updateBufferWith = (name: string | undefined, updater: Updater<Buffer>) =>
		name ? updateBuffer(state, { server: serverID, name }, updater) : undefined;
	const updateUser = (name: string, updater: Updater<User>) => {
		return updateServerWith((server) => {
			const users = new irc.CaseMapMap(server.users);
			const updated = updateState(users.get(name) ?? ({ nick: name } as User), updater);
			if (!updated) {
				return;
			}
			users.set(name, updated);
			return { users };
		});
	};
	const apply = (update: Partial<State> | undefined) => {
		state = { ...state, ...update };
	};

	// Don't update our internal state if it's a chat history message
	if (irc.findBatchByType(msg, "chathistory")) {
		return;
	}

	const prefix = msg.prefix ?? { name: "*" };
	let target: string, channel: string, topic: string;
	switch (msg.command) {
		case irc.RPL_MYINFO: {
			// TODO: parse available modes
			const serverInfo = {
				name: msg.params[1],
				version: msg.params[2],
			};
			return updateBufferWith(SERVER_BUFFER, { serverInfo });
		}
		case irc.RPL_ISUPPORT: {
			const buffers = new Map(state.buffers);
			state.buffers.forEach((buf) => {
				if (buf.server !== serverID) {
					return;
				}
				const members = new irc.CaseMapMap(buf.members, client.cm);
				const pendingMembers =
					buf.pendingMembers && new irc.CaseMapMap(buf.pendingMembers, client.cm);
				buffers.set(buf.id, { ...buf, members, pendingMembers });
			});
			return {
				buffers,
				...updateServerWith((server) => {
					return {
						name: client.isupport.network() ?? null,
						cm: client.cm,
						users: new irc.CaseMapMap(server.users, client.cm),
						metadata: new irc.CaseMapMap(server.metadata, client.cm),
						reliableUserAccounts: client.isupport.monitor() > 0 && client.isupport.whox(),
						statusMsg: client.isupport.statusMsg(),
						membershipModes: client.isupport.membershipModes(),
						bouncerNetID: client.isupport.bouncerNetID() ?? null,
						features: computeFeatures(client),
					};
				}),
			};
		}
		case irc.RPL_WELCOME:
			return updateServerWith({ nick: msg.params[0] });
		case "METADATA":
		case irc.RPL_KEYVALUE: {
			// METADATA <target> <key> <visibility> [value]
			// RPL_KEYVALUE <client> <target> <key> <visibility> <value>
			const [target, key, , value] = msg.command === "METADATA" ? msg.params : msg.params.slice(1);
			const field = (Object.keys(METADATA_KEYS) as (keyof TargetMetadata)[]).find(
				(k) => METADATA_KEYS[k] === key?.toLowerCase(),
			);
			if (!target || !field) {
				return;
			}
			return updateServerWith((server) => {
				const metadata = new irc.CaseMapMap(server.metadata);
				metadata.set(target, { ...metadata.get(target), [field]: value === "1" });
				return { metadata };
			});
		}
		case "CAP":
			return updateServerWith({
				features: computeFeatures(client),
				supportsSASLPlain: client.supportsSASL("PLAIN"),
				supportsAccountRegistration: client.caps.enabled.has("draft/account-registration"),
				isBouncer: client.caps.enabled.has("soju.im/bouncer-networks"),
			});
		case irc.RPL_LOGGEDIN:
			return updateServerWith({ account: msg.params[2] });
		case irc.RPL_LOGGEDOUT:
			return updateServerWith({ account: null });
		case "REGISTER":
		case "VERIFY":
			if (msg.params[0] === "SUCCESS") {
				return updateServerWith({ account: msg.params[1] });
			}
			break;
		case irc.RPL_NOTOPIC:
			channel = msg.params[1];
			return updateBufferWith(channel, { topic: null });
		case irc.RPL_TOPIC:
			channel = msg.params[1];
			topic = msg.params[2];
			return updateBufferWith(channel, { topic });
		case irc.RPL_NAMREPLY: {
			channel = msg.params[2];
			const membershipPrefixes = client.isupport
				.membershipModes()
				.map(({ prefix }) => prefix)
				.join("");
			return updateBufferWith(channel, (buf) => {
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
		}
		case irc.RPL_ENDOFNAMES:
			channel = msg.params[1];
			return updateBufferWith(channel, (buf) => ({
				members: buf.pendingMembers ?? new irc.CaseMapMap<string>(null, buf.members.caseMap),
				pendingMembers: null,
				hasNames: true,
			}));
		case irc.RPL_ENDOFWHO: {
			target = msg.params[1] ?? "";
			const list = msg.list || [];
			if (list.length === 0 && target && !client.isChannel(target) && target.indexOf("*") < 0) {
				// Not a channel nor a mask, likely a nick
				return updateUser(target, { offline: true });
			}
			return updateServerWith((server) => {
				const users = new irc.CaseMapMap(server.users);
				for (const reply of list) {
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

					users.set(who.nick, { ...users.get(who.nick), ...user });
				}
				return { users };
			});
		}
		case "JOIN": {
			channel = msg.params[0];

			if (client.isMyNick(prefix.name)) {
				const [, update] = createBuffer(state, channel, serverID, client);
				apply(update ?? undefined);
			}

			apply(
				updateBufferWith(channel, (buf) => {
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
			if (msg.params.length > 2) {
				who.account = msg.params[1] === "*" ? null : msg.params[1];
				who.realname = msg.params[2];
			}
			apply(updateUser(prefix.name, who));

			return state;
		}
		case "PART":
		case "KICK": {
			channel = msg.params[0];
			const nick = msg.command === "KICK" ? msg.params[1] : prefix.name;

			return updateBufferWith(channel, (buf) => {
				if (client.isMyNick(nick)) {
					return leftChannel(buf);
				}
				return editMembers(buf, (members) => members.delete(nick));
			});
		}
		case "QUIT": {
			state = renameMember(state, serverID, prefix.name, null);

			apply(
				updateServerWith((server) => {
					const user = server.users.get(prefix.name);
					if (!user) {
						return;
					}
					const users = new irc.CaseMapMap(server.users);
					users.set(prefix.name, { ...user, offline: true });
					return { users };
				}),
			);

			return state;
		}
		case "NICK": {
			const newNick = msg.params[0];
			if (client.isMyNick(prefix.name) || client.isMyNick(newNick)) {
				apply(updateServerWith({ nick: newNick }));
			}

			state = renameMember(state, serverID, prefix.name, newNick);

			apply(
				updateServerWith((server) => {
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

			return state;
		}
		case "SETNAME":
			return updateUser(prefix.name, { realname: msg.params[0] });
		case "CHGHOST":
			return updateUser(prefix.name, {
				username: msg.params[0],
				hostname: msg.params[1],
			});
		case "ACCOUNT": {
			const account = msg.params[0] === "*" ? null : msg.params[0];
			return updateUser(prefix.name, { account });
		}
		case "AWAY": {
			const awayMessage = msg.params[0];
			return updateUser(prefix.name, { away: Boolean(awayMessage) });
		}
		case "TOPIC":
			channel = msg.params[0];
			topic = msg.params[1];
			return updateBufferWith(channel, { topic });
		case "MODE": {
			target = msg.params[0];

			if (!client.isChannel(target)) {
				return; // TODO: handle user mode changes too
			}

			const membershipModes = client.isupport.membershipModes();
			const prefixByMode = new Map(
				membershipModes.map((membership) => [membership.mode, membership.prefix]),
			);

			return updateBufferWith(target, (buf) =>
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
		}
		case "RENAME": {
			// draft/channel-rename
			const [from, to] = msg.params;
			const buf = getBuffer(state, { server: serverID, name: from });
			if (!buf) {
				return;
			}
			const bufferList = Array.from(state.buffers.values()).map((b) =>
				b.id === buf.id ? { ...b, name: to } : b,
			);
			return { buffers: sortBuffers(state, bufferList) };
		}
		case "PRIVMSG":
		case "NOTICE":
		case "TAGMSG": {
			if (!msg.prefix?.user) {
				return;
			}
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
			return updateUser(prefix.name, update);
		}
		case "REDACT":
			return handleRedact(state, msg, serverID, client);
		case irc.RPL_MONONLINE:
		case irc.RPL_MONOFFLINE: {
			const targets = (msg.params[1] ?? "").split(",").filter(Boolean);

			for (const t of targets) {
				const p = irc.parsePrefix(t);
				apply(updateUser(p.name, { offline: msg.command === irc.RPL_MONOFFLINE }));
			}

			return state;
		}
	}
	return undefined;
}
