import * as irc from "./lib/irc";
import type { CaseMapFn, Message, MembershipMode } from "./lib/irc";
import { ClientStatus } from "./lib/client";
import type Client from "./lib/client";

export const SERVER_BUFFER = "*";

export const BufferType = {
	SERVER: "server",
	CHANNEL: "channel",
	NICK: "nick",
} as const;
export type BufferType = (typeof BufferType)[keyof typeof BufferType];

export const ServerStatus = ClientStatus;
export type ServerStatus = ClientStatus;

export const Unread = {
	NONE: "",
	MESSAGE: "message",
	HIGHLIGHT: "highlight",
} as const;
export type Unread = (typeof Unread)[keyof typeof Unread];

const unreadPriority: Record<Unread, number> = {
	[Unread.NONE]: 0,
	[Unread.MESSAGE]: 1,
	[Unread.HIGHLIGHT]: 2,
};

export function compareUnread(a: Unread, b: Unread): number {
	return unreadPriority[a] - unreadPriority[b];
}

export function unionUnread(a: Unread, b: Unread): Unread {
	return compareUnread(a, b) > 0 ? a : b;
}

export const ReceiptType = {
	DELIVERED: "delivered",
	READ: "read",
} as const;
export type ReceiptType = (typeof ReceiptType)[keyof typeof ReceiptType];

export interface Receipt {
	time: string;
}

export const BufferEventsDisplayMode = {
	FOLD: "fold",
	EXPAND: "expand",
	HIDE: "hide",
} as const;
export type BufferEventsDisplayMode = (typeof BufferEventsDisplayMode)[keyof typeof BufferEventsDisplayMode];

export type MessageLayout = "comfortable" | "compact";

export interface Settings {
	/** Color theme ID, see themes.ts */
	theme: string;
	/** Comfortable groups messages under the sender's name, compact is classic IRC */
	layout: MessageLayout;
	secondsInTimestamps: boolean;
	bufferEvents: BufferEventsDisplayMode;
	showMemberList: boolean;
	/** Receive Web Push notifications when gamja is closed */
	pushNotifications: boolean;
}

export const defaultSettings: Settings = {
	theme: "system",
	layout: "comfortable",
	secondsInTimestamps: true,
	bufferEvents: BufferEventsDisplayMode.FOLD,
	showMemberList: false,
	pushNotifications: false,
};

export interface User {
	nick: string;
	username?: string;
	hostname?: string;
	realname?: string;
	account?: string | null;
	away?: boolean;
	offline?: boolean;
	operator?: boolean;
	bot?: boolean;
}

export interface Server {
	id: number;
	/** From ISUPPORT NETWORK */
	name: string | null;
	status: ServerStatus;
	cm: CaseMapFn;
	users: irc.CaseMapMap<User>;
	account: string | null;
	supportsSASLPlain: boolean;
	supportsAccountRegistration: boolean;
	reliableUserAccounts: boolean;
	/** From ISUPPORT STATUSMSG */
	statusMsg: string | null;
	/** From ISUPPORT PREFIX */
	membershipModes: MembershipMode[] | null;
	isBouncer: boolean;
	bouncerNetID: string | null;
	/** Our current nickname */
	nick: string | null;
	/** Optional features supported by the server */
	features: Features;
}

export interface Features {
	reactions: boolean;
	replies: boolean;
	typing: boolean;
	redaction: boolean;
	search: boolean;
	webPush: boolean;
}

const noFeatures: Features = {
	reactions: false,
	replies: false,
	typing: false,
	redaction: false,
	search: false,
	webPush: false,
};

export function computeFeatures(client: Pick<Client, "caps" | "isupport">): Features {
	const tags = client.caps.enabled.has("message-tags");
	return {
		reactions: tags && irc.isClientTagAllowed(client.isupport, "draft/react"),
		replies: tags && irc.isClientTagAllowed(client.isupport, "draft/reply"),
		typing: tags && irc.isClientTagAllowed(client.isupport, "typing"),
		redaction: client.caps.enabled.has("draft/message-redaction"),
		search: client.caps.enabled.has("soju.im/search"),
		webPush: client.caps.enabled.has("soju.im/webpush") && Boolean(client.isupport.vapid()),
	};
}

export interface ServerInfo {
	name: string;
	version: string;
}

export interface Buffer {
	id: number;
	name: string;
	type: BufferType;
	server: number;
	/** If server buffer */
	serverInfo: ServerInfo | null;
	/** If channel */
	joined: boolean;
	topic: string | null;
	hasInitialWho: boolean;
	/** Whether a NAMES reply has been received, if channel */
	hasNames: boolean;
	/** Nick → membership prefixes, if channel */
	members: irc.CaseMapMap<string>;
	messages: Message[];
	/** msgids of deleted messages */
	redacted: Set<string>;
	/** msgid → emoji → nicks who reacted */
	reactions: Map<string, Map<string, string[]>>;
	/** Users currently typing, by nick */
	typing: Map<string, TypingState>;
	/** Chat history status: unknown before the first fetch, end once all fetched */
	history: "unknown" | "loading" | "more" | "end" | "error";
	unread: Unread;
	prevReadReceipt: Receipt | null;
}

export interface TypingState {
	status: "active" | "paused";
	/** When the status was received, in milliseconds since the epoch */
	time: number;
}

/** How long typing notifications stay valid without updates, per the +typing spec */
export const TYPING_TIMEOUT = { active: 6000, paused: 30000 } as const;

export type BouncerNetwork = Record<string, string | null | undefined>;

export interface State {
	servers: Map<number, Server>;
	buffers: Map<number, Buffer>;
	activeBuffer: number | null;
	bouncerNetworks: Map<string, BouncerNetwork>;
	settings: Settings;
}

/** Identifies a buffer, either by ID or by server and name. */
export type BufferID = number | { id?: number; server?: number | null; name?: string | null } | Buffer;

export type Update<S> = Partial<S> | undefined | null | void;
export type Updater<S> = Update<S> | ((s: S) => Update<S>);

export function getBufferURL(
	buf: Pick<Buffer, "type" | "name">,
	bouncerNetwork: BouncerNetwork | null = null,
): string {
	const host = bouncerNetwork?.host ?? undefined;
	switch (buf.type) {
		case BufferType.SERVER:
			return irc.formatURL({ host });
		case BufferType.CHANNEL:
			return irc.formatURL({ host, entity: buf.name });
		case BufferType.NICK:
			return irc.formatURL({ host, entity: buf.name, enttype: "user" });
	}
}

export function getMessageURL(
	buf: Buffer,
	msg: Message,
	bouncerNetwork: BouncerNetwork | null = null,
): string | null {
	const bufURL = getBufferURL(buf, bouncerNetwork);
	if (msg.tags.msgid) {
		return bufURL + "?msgid=" + encodeURIComponent(msg.tags.msgid);
	} else if (msg.tags.time) {
		return bufURL + "?timestamp=" + encodeURIComponent(msg.tags.time);
	} else {
		return null;
	}
}

export function getServerName(
	server: Pick<Server, "name" | "isBouncer">,
	bouncerNetwork: BouncerNetwork | null | undefined,
): string {
	const netName = server.name;

	if (bouncerNetwork && bouncerNetwork.name && bouncerNetwork.name !== bouncerNetwork.host) {
		// User has picked a custom name for the network, use that
		return bouncerNetwork.name;
	}

	if (netName) {
		// Server has specified a name
		return netName;
	}

	if (bouncerNetwork) {
		return bouncerNetwork.name || bouncerNetwork.host || "server";
	} else if (server.isBouncer) {
		return "bouncer";
	} else {
		return "server";
	}
}

export function receiptFromMessage(msg: Message): Receipt {
	// At this point all messages are supposed to have a time tag.
	// The controller ensures this is the case even if the server doesn't
	// support server-time.
	if (!msg.tags.time) {
		throw new Error("Missing time message tag");
	}
	return { time: msg.tags.time };
}

export function isReceiptBefore(a: Receipt | null | undefined, b: Receipt | null | undefined): boolean {
	if (!b) {
		return false;
	}
	if (!a) {
		return true;
	}
	if (!a.time || !b.time) {
		throw new Error("Missing receipt time");
	}
	return a.time <= b.time;
}

export function isMessageBeforeReceipt(msg: Message, receipt: Receipt | null | undefined): boolean {
	if (!receipt) {
		return false;
	}
	if (!msg.tags.time) {
		throw new Error("Missing time message tag");
	}
	if (!receipt.time) {
		throw new Error("Missing receipt time");
	}
	return msg.tags.time <= receipt.time;
}

function updateState<S extends object>(state: S, updater: Updater<S>): S | undefined {
	const updated = typeof updater === "function" ? updater(state) : updater;
	if (!updated || (updated as unknown) === state) {
		return undefined;
	}
	return { ...state, ...updated };
}

function trimStartCharacter(s: string, c: string): string {
	let i = 0;
	for (; i < s.length; ++i) {
		if (s[i] !== c) {
			break;
		}
	}
	return s.substring(i);
}

function getBouncerNetworkNameFromBuffer(state: State, buffer: Buffer): string | null {
	const server = state.servers.get(buffer.server);
	if (!server || !server.bouncerNetID) {
		return null;
	}
	const network = state.bouncerNetworks.get(server.bouncerNetID);
	if (!network) {
		return null;
	}
	return getServerName(server, network);
}

/* Returns a positive number if a should appear after b, a negative number if
 * a should appear before b, or 0 otherwise. */
export function compareBuffers(state: State, a: Buffer, b: Buffer): number {
	if (a.server !== b.server) {
		const aServerName = getBouncerNetworkNameFromBuffer(state, a);
		const bServerName = getBouncerNetworkNameFromBuffer(state, b);
		if (aServerName && bServerName && aServerName !== bServerName) {
			return aServerName.localeCompare(bServerName);
		}
		return a.server > b.server ? 1 : -1;
	}
	if ((a.type === BufferType.SERVER) !== (b.type === BufferType.SERVER)) {
		return b.type === BufferType.SERVER ? 1 : -1;
	}
	if ((a.type === BufferType.CHANNEL) !== (b.type === BufferType.CHANNEL)) {
		// Channels before private conversations
		return b.type === BufferType.CHANNEL ? 1 : -1;
	}

	if (a.type === BufferType.CHANNEL && b.type === BufferType.CHANNEL) {
		const strippedA = trimStartCharacter(a.name, a.name[0]);
		const strippedB = trimStartCharacter(b.name, b.name[0]);
		const cmp = strippedA.localeCompare(strippedB);

		if (cmp !== 0) {
			return cmp;
		}
		// if they are the same when stripped, fallthough to default logic
	}

	return a.name.localeCompare(b.name);
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

/* Insert a message in an immutable list of sorted messages. */
export function insertMessage(list: Message[], msg: Message): Message[] {
	if (list.length === 0) {
		return [msg];
	} else if (list[list.length - 1].tags.time! <= msg.tags.time!) {
		return list.concat(msg);
	}

	// Skip duplicates, e.g. when history overlaps with live messages
	if (msg.tags.msgid && list.some((other) => other.tags.msgid === msg.tags.msgid)) {
		return list;
	}

	let insertBefore = list.length;
	for (let i = 0; i < list.length; i++) {
		if (msg.tags.time! < list[i].tags.time!) {
			insertBefore = i;
			break;
		}
	}

	list = [...list];
	list.splice(insertBefore, 0, msg);
	return list;
}

let lastServerID = 0;
let lastBufferID = 0;
let lastMessageKey = 0;

export function createState(): State {
	return {
		servers: new Map(),
		buffers: new Map(),
		activeBuffer: null,
		bouncerNetworks: new Map(),
		settings: { ...defaultSettings },
	};
}

export function updateServer(state: State, id: number, updater: Updater<Server>): Partial<State> | undefined {
	const server = state.servers.get(id);
	if (!server) {
		return;
	}

	const updated = updateState(server, updater);
	if (!updated) {
		return;
	}

	const servers = new Map(state.servers);
	servers.set(id, updated);
	return { servers };
}

export function updateBuffer(
	state: State,
	id: BufferID,
	updater: Updater<Buffer>,
): Partial<State> | undefined {
	const buf = getBuffer(state, id);
	if (!buf) {
		return;
	}

	const updated = updateState(buf, updater);
	if (!updated) {
		return;
	}

	const buffers = new Map(state.buffers);
	buffers.set(buf.id, updated);
	return { buffers };
}

export function getActiveServerID(state: State): number | null {
	const buf = state.activeBuffer !== null ? state.buffers.get(state.activeBuffer) : undefined;
	if (!buf) {
		return null;
	}
	return buf.server;
}

export function getBuffer(state: State, id: BufferID | null | undefined): Buffer | undefined {
	if (id === null || id === undefined) {
		return undefined;
	}
	if (typeof id === "number") {
		return state.buffers.get(id);
	}
	if (id.id) {
		return state.buffers.get(id.id);
	}

	let serverID = id.server;
	let name = id.name;
	if (!serverID) {
		serverID = getActiveServerID(state);
	}
	if (!name) {
		name = SERVER_BUFFER;
	}

	let cm = irc.CaseMapping.RFC1459;
	const server = serverID ? state.servers.get(serverID) : undefined;
	if (server) {
		cm = server.cm;
	}

	const nameCM = cm(name);
	for (const buf of state.buffers.values()) {
		if (buf.server === serverID && cm(buf.name) === nameCM) {
			return buf;
		}
	}
	return undefined;
}

export function createServer(state: State): [number, Partial<State>] {
	lastServerID++;
	const id = lastServerID;

	const servers = new Map(state.servers);
	servers.set(id, {
		id,
		name: null,
		status: ServerStatus.DISCONNECTED,
		cm: irc.CaseMapping.RFC1459,
		users: new irc.CaseMapMap<User>(null, irc.CaseMapping.RFC1459),
		account: null,
		supportsSASLPlain: false,
		supportsAccountRegistration: false,
		reliableUserAccounts: false,
		statusMsg: null,
		membershipModes: null,
		isBouncer: false,
		bouncerNetID: null,
		nick: null,
		features: noFeatures,
	});
	return [id, { servers }];
}

export function createBuffer(
	state: State,
	name: string,
	serverID: number,
	client: Pick<Client, "isChannel" | "cm">,
): [number, Partial<State> | null] {
	const existing = getBuffer(state, { server: serverID, name });
	if (existing) {
		return [existing.id, null];
	}

	lastBufferID++;
	const id = lastBufferID;

	let type: BufferType;
	if (name === SERVER_BUFFER) {
		type = BufferType.SERVER;
	} else if (client.isChannel(name)) {
		type = BufferType.CHANNEL;
	} else {
		type = BufferType.NICK;
	}

	let bufferList = Array.from(state.buffers.values());
	bufferList.push({
		id,
		name,
		type,
		server: serverID,
		serverInfo: null,
		joined: false,
		topic: null,
		hasInitialWho: false,
		hasNames: false,
		members: new irc.CaseMapMap<string>(null, client.cm),
		messages: [],
		redacted: new Set(),
		reactions: new Map(),
		typing: new Map(),
		history: "unknown",
		unread: Unread.NONE,
		prevReadReceipt: null,
	});
	bufferList = bufferList.sort((a, b) => compareBuffers(state, a, b));
	const buffers = new Map(bufferList.map((buf) => [buf.id, buf]));
	return [id, { buffers }];
}

export function storeBouncerNetwork(state: State, id: string, attrs: BouncerNetwork): Partial<State> {
	const bouncerNetworks = new Map(state.bouncerNetworks);
	bouncerNetworks.set(id, {
		...bouncerNetworks.get(id),
		...attrs,
	});
	return { bouncerNetworks };
}

export function deleteBouncerNetwork(state: State, id: string): Partial<State> {
	const bouncerNetworks = new Map(state.bouncerNetworks);
	bouncerNetworks.delete(id);
	return { bouncerNetworks };
}

/** Update the state according to an incoming IRC message. */
export function handleMessage(
	state: State,
	msg: Message,
	serverID: number,
	client: Client,
): Partial<State> | undefined {
	const updateServerWith = (updater: Updater<Server>) => updateServer(state, serverID, updater);
	const updateBufferWith = (name: string, updater: Updater<Buffer>) =>
		updateBuffer(state, { server: serverID, name }, updater);
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
				buffers.set(buf.id, { ...buf, members });
			});
			return {
				buffers,
				...updateServerWith((server) => {
					return {
						name: client.isupport.network() ?? null,
						cm: client.cm,
						users: new irc.CaseMapMap(server.users, client.cm),
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
		case irc.RPL_ENDOFNAMES: {
			channel = msg.params[1];
			const membershipPrefixes = client.isupport
				.membershipModes()
				.map(({ prefix }) => prefix)
				.join("");
			return updateBufferWith(channel, (buf) => {
				const members = new irc.CaseMapMap<string>(null, buf.members.caseMap);
				for (const namreply of msg.list || []) {
					for (const s of (namreply.params[3] ?? "").split(" ")) {
						if (!s) {
							continue;
						}
						const member = irc.parseTargetPrefix(s, membershipPrefixes);
						// userhost-in-names
						const name = irc.parsePrefix(member.name).name;
						members.set(name, member.prefix);
					}
				}
				return { members, hasNames: true };
			});
		}
		case irc.RPL_ENDOFWHO: {
			target = msg.params[1];
			const list = msg.list || [];
			if (list.length === 0 && !client.isChannel(target) && target.indexOf("*") < 0) {
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
					const members = new irc.CaseMapMap(buf.members);
					members.set(prefix.name, "");

					const joined = buf.joined || client.isMyNick(prefix.name);

					return { members, joined };
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
			channel = msg.params[0];

			return updateBufferWith(channel, (buf) => {
				const members = new irc.CaseMapMap(buf.members);
				members.delete(prefix.name);

				const joined = buf.joined && !client.isMyNick(prefix.name);

				return { members, joined };
			});
		case "KICK": {
			channel = msg.params[0];
			const nick = msg.params[1];

			return updateBufferWith(channel, (buf) => {
				const members = new irc.CaseMapMap(buf.members);
				members.delete(nick);

				const joined = buf.joined && !client.isMyNick(nick);

				return { members, joined };
			});
		}
		case "QUIT": {
			const buffers = new Map(state.buffers);
			state.buffers.forEach((buf) => {
				if (buf.server !== serverID) {
					return;
				}
				if (!buf.members.has(prefix.name)) {
					return;
				}
				const members = new irc.CaseMapMap(buf.members);
				members.delete(prefix.name);
				buffers.set(buf.id, { ...buf, members });
			});
			state = { ...state, buffers };

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

			const buffers = new Map(state.buffers);
			state.buffers.forEach((buf) => {
				if (buf.server !== serverID) {
					return;
				}
				const membership = buf.members.get(prefix.name);
				if (membership === undefined) {
					return;
				}
				const members = new irc.CaseMapMap(buf.members);
				members.delete(prefix.name);
				members.set(newNick, membership);
				buffers.set(buf.id, { ...buf, members });
			});
			state = { ...state, buffers };

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

			return updateBufferWith(target, (buf) => {
				const members = new irc.CaseMapMap(buf.members);

				irc.forEachChannelModeUpdate(msg, client.isupport, (mode, add, arg) => {
					const letter = prefixByMode.get(mode);
					if (letter === undefined) {
						return;
					}
					const nick = arg;
					if (!nick) {
						throw new Error(`Missing membership MODE "${mode}" argument`);
					}
					const membership = members.get(nick);
					if (membership === undefined) {
						return;
					}
					members.set(nick, updateMembership(membership, letter, add, client));
				});

				return { members };
			});
		}
		case "RENAME": {
			// draft/channel-rename
			const [from, to] = msg.params;
			const buf = getBuffer(state, { server: serverID, name: from });
			if (!buf) {
				return;
			}
			let bufferList = Array.from(state.buffers.values()).map((b) =>
				b.id === buf.id ? { ...b, name: to } : b,
			);
			bufferList = bufferList.sort((a, b) => compareBuffers(state, a, b));
			return { buffers: new Map(bufferList.map((b) => [b.id, b])) };
		}
		case "PRIVMSG":
		case "NOTICE":
		case "TAGMSG": {
			// account-tag
			const account = msg.tags.account;
			if (account === undefined || !msg.prefix?.user) {
				return;
			}
			const user = state.servers.get(serverID)?.users.get(prefix.name);
			if (user && user.account === account) {
				return;
			}
			return updateUser(prefix.name, { account });
		}
		case "REDACT":
			target = msg.params[0];
			if (client.isMyNick(target)) {
				target = prefix.name;
			}
			return updateBufferWith(target, (buf) => {
				return { redacted: new Set(buf.redacted).add(msg.params[1]) };
			});
		case irc.RPL_MONONLINE:
		case irc.RPL_MONOFFLINE: {
			const targets = msg.params[1].split(",");

			for (const t of targets) {
				const p = irc.parsePrefix(t);
				apply(updateUser(p.name, { offline: msg.command === irc.RPL_MONOFFLINE }));
			}

			return state;
		}
	}
	return undefined;
}

/** Add or remove a reaction to a message. */
export function applyReaction(
	buf: Buffer,
	msgid: string,
	emoji: string,
	nick: string,
	add: boolean,
	cm: CaseMapFn,
): Partial<Buffer> | undefined {
	const byEmoji = new Map(buf.reactions.get(msgid));
	const nicks = byEmoji.get(emoji) ?? [];
	const has = nicks.some((n) => cm(n) === cm(nick));
	if (has === add) {
		return;
	}
	const updated = add ? [...nicks, nick] : nicks.filter((n) => cm(n) !== cm(nick));
	if (updated.length > 0) {
		byEmoji.set(emoji, updated);
	} else {
		byEmoji.delete(emoji);
	}
	const reactions = new Map(buf.reactions);
	if (byEmoji.size > 0) {
		reactions.set(msgid, byEmoji);
	} else {
		reactions.delete(msgid);
	}
	return { reactions };
}

/** Update the typing status of a user, "done" clears it. */
export function applyTyping(
	buf: Buffer,
	nick: string,
	status: string,
	cm: CaseMapFn,
	now = Date.now(),
): Partial<Buffer> | undefined {
	const typing = new Map(buf.typing);
	for (const k of typing.keys()) {
		if (cm(k) === cm(nick)) {
			typing.delete(k);
		}
	}
	if (status === "active" || status === "paused") {
		typing.set(nick, { status, time: now });
	} else if (typing.size === buf.typing.size) {
		return;
	}
	return { typing };
}

/** Nicks currently typing in a buffer, excluding expired notifications. */
export function getTypingNicks(buf: Buffer, now = Date.now()): string[] {
	const nicks: string[] = [];
	for (const [nick, t] of buf.typing) {
		if (now - t.time < TYPING_TIMEOUT[t.status] && t.status === "active") {
			nicks.push(nick);
		}
	}
	return nicks;
}

export function addMessage(state: State, msg: Message, bufID: BufferID): Partial<State> | undefined {
	lastMessageKey++;
	msg.key = lastMessageKey;

	return updateBuffer(state, bufID, (buf) => {
		const messages = insertMessage(buf.messages, msg);
		if (messages === buf.messages) {
			return;
		}
		return { messages };
	});
}
