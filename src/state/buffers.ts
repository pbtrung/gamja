/** Servers and buffers: creating, finding and updating them, and their messages. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
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
	type State,
	type TargetMetadata,
	type Updater,
	type User,
	type Server,
} from "./model";
import { sortBuffers } from "./display";
import { insertMessage, mergeMessages } from "./messages";
import { defaultSettings } from "./settings";

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

export function updateState<S extends object>(state: S, updater: Updater<S>): S | undefined {
	const updated = typeof updater === "function" ? updater(state) : updater;
	if (!updated || (updated as unknown) === state) {
		return undefined;
	}
	return { ...state, ...updated };
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

function getBufferType(name: string, client: Pick<Client, "isChannel">): BufferType {
	if (name === SERVER_BUFFER) {
		return BufferType.SERVER;
	} else if (client.isChannel(name)) {
		return BufferType.CHANNEL;
	} else {
		return BufferType.NICK;
	}
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

	const type = getBufferType(name, client);
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

/** Messages kept per buffer, older ones are dropped, see trimMessages() */
export const MAX_MESSAGES = 2000;

/**
 * Drop the oldest messages past MAX_MESSAGES. With chat history, they can be
 * fetched again when scrolling up. Buffers loading history or with missed
 * messages to fetch are kept as is, their bounds depend on the messages.
 */
export function trimMessages(buf: Buffer, refetchable: boolean): Partial<Buffer> | undefined {
	if (buf.messages.length <= MAX_MESSAGES || buf.gap || buf.history === "loading") {
		return;
	}
	const messages = buf.messages.slice(-MAX_MESSAGES);
	if (!refetchable) {
		return { messages };
	}
	return { messages, history: buf.history === "error" ? "error" : "more" };
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
