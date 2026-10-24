/**
 * soju.im/multiplex: the bouncer networks attached to the bouncer
 * connection, instead of one WebSocket per network. See soju-rs's
 * doc/multiplex.md.
 *
 * The client of a network keeps working as if it had its own connection: it
 * gets a VirtualSocket instead of a WebSocket. The Multiplexer of the bouncer
 * connection's client sends its lines with the network's tag, and hands it
 * the lines tagged with its network.
 */

import * as irc from "../irc";
import type { Message } from "../irc";
import type { ClientConnection } from "./connection";
import { IRCError, WEBSOCKET_CLOSE_CODES } from "./errors";
import { ClientStatus, type MessageEventDetail } from "./types";

export const MULTIPLEX_CAP = "soju.im/multiplex";
export const NETWORK_TAG = "soju.im/network";

/** Caps of the bouncer connection a network's connection doesn't have. */
const NOT_INHERITED_CAPS = [MULTIPLEX_CAP, "soju.im/bouncer-networks-notify"];

/** Add the network tag to a raw IRC line. */
export function addNetworkTag(raw: string, netID: string): string {
	const tag = `${NETWORK_TAG}=${netID}`;
	return raw.startsWith("@") ? `@${tag};${raw.slice(1)}` : `@${tag} ${raw}`;
}

/** Split the network tag off a raw IRC line: the network ID, null without it, and the line without it. */
export function splitNetworkTag(raw: string): [string | null, string] {
	if (!raw.startsWith("@")) {
		return [null, raw];
	}
	const end = raw.indexOf(" ");
	if (end < 0) {
		return [null, raw];
	}
	const tags = raw.slice(1, end).split(";");
	const i = tags.findIndex((t) => t.startsWith(NETWORK_TAG + "="));
	if (i < 0) {
		return [null, raw];
	}
	const netID = tags[i].slice(NETWORK_TAG.length + 1);
	tags.splice(i, 1);
	const rest = raw.slice(end + 1).trimStart();
	return [netID, tags.length > 0 ? `@${tags.join(";")} ${rest}` : rest];
}

type SocketState = "connecting" | "open" | "closed";

/**
 * The connection of a network attached to the bouncer connection, with the
 * parts of the WebSocket interface ClientConnection uses. Events are
 * dispatched asynchronously, like a WebSocket's.
 */
export class VirtualSocket extends EventTarget {
	readonly netID: string;
	state: SocketState = "connecting";
	private mux: Multiplexer;

	constructor(mux: Multiplexer, netID: string) {
		super();
		this.mux = mux;
		this.netID = netID;
	}

	send(data: string): void {
		if (this.state !== "open") {
			throw new Error("Network not attached");
		}
		this.mux.sendLine(addNetworkTag(data, this.netID));
	}

	close(code: number = WEBSOCKET_CLOSE_CODES.NORMAL_CLOSURE): void {
		if (this.state === "closed") {
			return;
		}
		this.mux.remove(this, this.state === "open");
		this.end(code);
	}

	/** Attached: the bouncer registers the network's connection. */
	attached(): void {
		this.state = "open";
		queueMicrotask(() => {
			if (this.state === "open") {
				this.dispatchEvent(new Event("open"));
			}
		});
	}

	receive(line: string): void {
		if (this.state === "open") {
			this.dispatchEvent(Object.assign(new Event("message"), { data: line }));
		}
	}

	end(code: number): void {
		if (this.state === "closed") {
			return;
		}
		this.state = "closed";
		queueMicrotask(() => {
			this.dispatchEvent(Object.assign(new Event("close"), { code }));
		});
	}
}

/** The networks attached to a bouncer connection, see the module comment. */
export class Multiplexer {
	readonly parent: ClientConnection;
	/** The connections of the attached networks, or waiting to be */
	sockets = new Map<string, VirtualSocket>();
	/** The clients of the networks, by network ID */
	clients = new Map<string, ClientConnection>();

	constructor(parent: ClientConnection) {
		this.parent = parent;
		parent.addEventListener("status", () => {
			switch (parent.status) {
				case ClientStatus.REGISTERED:
					this.handleRegistered();
					break;
				case ClientStatus.DISCONNECTED:
					this.handleDisconnected();
					break;
			}
		});
		parent.addEventListener("message", (event) => {
			this.handleParentMessage((event as CustomEvent<MessageEventDetail>).detail.message);
		});
	}

	isReady(): boolean {
		return (
			this.parent.status === ClientStatus.REGISTERED &&
			this.parent.caps.enabled.has(MULTIPLEX_CAP) &&
			this.parent.ws !== null
		);
	}

	/** Open the connection of a network: attached now, or once the bouncer connection is registered. */
	open(netID: string, client: ClientConnection): VirtualSocket {
		this.clients.set(netID, client);
		// Replaced: attaching again replaces the previous connection
		this.sockets.get(netID)?.end(WEBSOCKET_CLOSE_CODES.GOING_AWAY);
		const socket = new VirtualSocket(this, netID);
		this.sockets.set(netID, socket);
		if (this.isReady()) {
			this.attach(socket);
		}
		return socket;
	}

	/** The caps of a network's connection when attached, see doc/multiplex.md. */
	inheritedCaps(): irc.CapRegistry {
		const caps = new irc.CapRegistry();
		const parentCaps = this.parent.caps;
		caps.available = new Map(parentCaps.available);
		caps.enabled = new Set([...parentCaps.enabled].filter((cap) => !NOT_INHERITED_CAPS.includes(cap)));
		caps.requested = new Set(caps.enabled);
		return caps;
	}

	attach(socket: VirtualSocket): void {
		this.parent.send({ command: "BOUNCER", params: ["ATTACH", socket.netID] });
		socket.attached();
	}

	/** Forget a closed connection, detaching its network if it was attached. */
	remove(socket: VirtualSocket, detach: boolean): void {
		if (this.sockets.get(socket.netID) !== socket) {
			return;
		}
		this.sockets.delete(socket.netID);
		if (detach && this.isReady()) {
			this.parent.send({ command: "BOUNCER", params: ["DETACH", socket.netID] });
		}
	}

	sendLine(line: string): void {
		const ws = this.parent.ws;
		if (!ws) {
			throw new Error("Bouncer connection is closed");
		}
		ws.send(line);
	}

	/** Hand a line of the bouncer connection to its network, returns false if it isn't tagged with one. */
	route(raw: string): boolean {
		const [netID, line] = splitNetworkTag(raw);
		if (netID === null) {
			return false;
		}
		// Late lines of a network just detached are dropped
		this.sockets.get(netID)?.receive(line);
		return true;
	}

	handleRegistered(): void {
		if (!this.parent.caps.enabled.has(MULTIPLEX_CAP)) {
			// The bouncer stopped supporting it: the networks get their own
			// connections again
			const clients = [...this.clients.values()];
			this.clients.clear();
			this.sockets.clear();
			for (const client of clients) {
				client.params.multiplexer = null;
				if (client.autoReconnect && client.status !== ClientStatus.REGISTERED) {
					client.reconnect();
				}
			}
			return;
		}
		for (const socket of this.sockets.values()) {
			if (socket.state === "connecting") {
				this.attach(socket);
			}
		}
		// Networks dropped with the bouncer connection come back now, rather
		// than after their reconnection delay
		for (const [netID, client] of this.clients) {
			if (
				client.params.multiplexer === this &&
				client.autoReconnect &&
				client.status === ClientStatus.DISCONNECTED &&
				!this.sockets.has(netID)
			) {
				client.reconnect();
			}
		}
	}

	handleDisconnected(): void {
		const sockets = [...this.sockets.values()];
		this.sockets.clear();
		for (const socket of sockets) {
			// Not an error of its own: the bouncer connection reports it
			socket.end(WEBSOCKET_CLOSE_CODES.GOING_AWAY);
		}
	}

	handleParentMessage(msg: Message): void {
		if (msg.command !== "FAIL" || msg.params[0] !== "BOUNCER" || msg.params[2] !== "ATTACH") {
			return;
		}
		const netID = msg.params[3];
		const socket = netID === undefined ? undefined : this.sockets.get(netID);
		if (!socket) {
			return;
		}
		this.sockets.delete(netID!);
		this.clients.get(netID!)?.dispatchError(new IRCError(msg));
		socket.end(WEBSOCKET_CLOSE_CODES.GOING_AWAY);
	}
}
