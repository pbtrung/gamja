/** Servers and buffers: creating, finding, updating and displaying them. */

import * as irc from "../lib/irc";
import type { CaseMapFn, Message } from "../lib/irc";
import type Client from "../lib/client";
import {
	BufferType,
	SERVER_BUFFER,
	ServerStatus,
	Unread,
	noFeatures,
	type BouncerNetwork,
	type Buffer,
	type BufferID,
	type Server,
	type State,
	type TargetMetadata,
	type Updater,
	type User,
	TYPING_TIMEOUT,
} from "./model";
import { insertMessage, mergeMessages } from "./messages";
import { defaultSettings } from "./settings";

/**
 * Identifies a server across reloads, e.g. to remember it's collapsed in the
 * buffer list: its bouncer network, if any
 */
export function getServerKey(server: Server): string {
	return server.bouncerNetID ?? "";
}

export function getTargetMetadata(server: Server | undefined, target: string): TargetMetadata {
	return server?.metadata.get(target) ?? {};
}

export interface BufferGroup {
	server: Buffer[];
	/** Buffers shown */
	shown: Buffer[];
	/** How many buffers hidden by collapsing have unread messages */
	hiddenUnread: number;
}

/**
 * Buffers in display order, by server: pinned ones right after their
 * server's buffer, keeping the order of the others. Collapsed servers only
 * show pinned buffers, the active one and those with highlights: hidden
 * ones never have highlights.
 */
export function displayGroups(
	buffers: Map<number, Buffer>,
	servers: Map<number, Server>,
	collapsed: ReadonlySet<string>,
	activeBuffer: number | null,
): BufferGroup[] {
	const pinned = (buf: Buffer) =>
		buf.type !== BufferType.SERVER &&
		Boolean(getTargetMetadata(servers.get(buf.server), buf.name).pinned);
	const byServer = new Map<number, Buffer[]>();
	for (const buf of buffers.values()) {
		const group = byServer.get(buf.server);
		if (group) {
			group.push(buf);
		} else {
			byServer.set(buf.server, [buf]);
		}
	}
	return [...byServer].map(([serverID, group]) => {
		const server = servers.get(serverID);
		const children = [
			...group.filter(pinned),
			...group.filter((buf) => buf.type !== BufferType.SERVER && !pinned(buf)),
		];
		const isCollapsed = server !== undefined && collapsed.has(getServerKey(server));
		const visible = (buf: Buffer) =>
			!isCollapsed || pinned(buf) || buf.id === activeBuffer || buf.unread === Unread.HIGHLIGHT;
		return {
			server: group.filter((buf) => buf.type === BufferType.SERVER),
			shown: children.filter(visible),
			hiddenUnread: children.filter(
				(buf) =>
					!visible(buf) && buf.unread !== Unread.NONE && !getTargetMetadata(server, buf.name).muted,
			).length,
		};
	});
}

/** The buffers shown in the buffer list, in order. */
export function displayedBuffers(
	buffers: Map<number, Buffer>,
	servers: Map<number, Server>,
	collapsed: ReadonlySet<string>,
	activeBuffer: number | null,
): Buffer[] {
	return displayGroups(buffers, servers, collapsed, activeBuffer).flatMap((g) => [...g.server, ...g.shown]);
}

/**
 * The state of a channel we left or got disconnected from: its members
 * are stale until it's joined again, which fetches them anew.
 */
export function leftChannel(buf: Buffer): Partial<Buffer> {
	return {
		joined: false,
		hasInitialWho: false,
		hasNames: false,
		members: new irc.CaseMapMap(null, buf.members.caseMap),
		pendingMembers: null,
		typing: new Map(),
	};
}

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

export function updateState<S extends object>(state: S, updater: Updater<S>): S | undefined {
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
function compareBuffers(state: State, a: Buffer, b: Buffer): number {
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
		metadata: new irc.CaseMapMap<TargetMetadata>(null, irc.CaseMapping.RFC1459),
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

	const bufferList = Array.from(state.buffers.values());
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
		pendingMembers: null,
		messages: [],
		redacted: new Set(),
		reactions: new Map(),
		typing: new Map(),
		history: "unknown",
		gap: null,
		unread: Unread.NONE,
		prevReadReceipt: null,
	});
	return [id, { buffers: sortBuffers(state, bufferList) }];
}

/** Sort buffers in the order of the buffer list, into a new map. */
export function sortBuffers(state: State, bufferList: Buffer[]): Map<number, Buffer> {
	bufferList.sort((a, b) => compareBuffers(state, a, b));
	return new Map(bufferList.map((buf) => [buf.id, buf]));
}

export function storeBouncerNetwork(state: State, id: string, attrs: BouncerNetwork): Partial<State> {
	const bouncerNetworks = new Map(state.bouncerNetworks);
	const merged: BouncerNetwork = { ...bouncerNetworks.get(id), ...attrs };
	// An attribute without a value was cleared (e.g. an error went away)
	for (const [k, v] of Object.entries(merged)) {
		if (v === undefined || v === null || v === "") {
			delete merged[k];
		}
	}
	bouncerNetworks.set(id, merged);
	return { bouncerNetworks };
}

export function deleteBouncerNetwork(state: State, id: string): Partial<State> {
	const bouncerNetworks = new Map(state.bouncerNetworks);
	bouncerNetworks.delete(id);
	return { bouncerNetworks };
}

// Reactions come from other users, who could reference any number of
// messages or emoji: keep a bounded amount
const MAX_REACTED_MESSAGES = 1000;
const MAX_EMOJI_PER_MESSAGE = 50;

/**
 * Add or remove a reaction to a message, which may not be loaded (yet).
 * The reactions of the messages reacted to first go first past the limit.
 */
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
	if (has === add || (add && nicks.length === 0 && byEmoji.size >= MAX_EMOJI_PER_MESSAGE)) {
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
	for (const oldest of reactions.keys()) {
		if (reactions.size <= MAX_REACTED_MESSAGES) {
			break;
		}
		reactions.delete(oldest);
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
	let had = false;
	for (const [k, t] of typing) {
		if (cm(k) === cm(nick)) {
			typing.delete(k);
			had = true;
		} else if (now - t.time >= TYPING_TIMEOUT[t.status]) {
			// Drop expired notifications while at it: users who never sent
			// "done" would stay in the map otherwise
			typing.delete(k);
		}
	}
	if (status === "active" || status === "paused") {
		typing.set(nick, { status, time: now });
	} else if (!had) {
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

/** Add several messages to a buffer at once, e.g. a page of history. */
export function addMessages(state: State, msgs: Message[], bufID: BufferID): Partial<State> | undefined {
	for (const msg of msgs) {
		lastMessageKey++;
		msg.key = lastMessageKey;
	}

	return updateBuffer(state, bufID, (buf) => {
		const messages = mergeMessages(buf.messages, msgs);
		if (messages === buf.messages) {
			return;
		}
		return { messages };
	});
}
