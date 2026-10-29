/** How servers and buffers are shown: their order, names and URLs. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import {
	BufferType,
	Unread,
	type BouncerNetwork,
	type Buffer,
	type Server,
	type State,
	type TargetMetadata,
} from "./model";

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

/** Sort buffers in the order of the buffer list, into a new map. */
export function sortBuffers(state: State, bufferList: Buffer[]): Map<number, Buffer> {
	bufferList.sort((a, b) => compareBuffers(state, a, b));
	return new Map(bufferList.map((buf) => [buf.id, buf]));
}
