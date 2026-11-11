/** The steps of a connection's life: opening the socket, registering, reconnecting. */

import * as irc from "../irc";
import { startRegistrationTimeout } from "./keepalive";
import type { ClientConnection, Socket } from "./connection";
import { ClientStatus } from "./types";

export const FALLBACK_SERVER_PREFIX: irc.Prefix = { name: "*" };

export const RECONNECT_MIN_DELAY_MSEC = 10 * 1000; // 10s
export const RECONNECT_MAX_DELAY_MSEC = 10 * 60 * 1000; // 10min

/** Open a socket, or an attached network's. Null if that failed. */
export function openSocket(client: ClientConnection): Socket | null {
	const mux = client.params.multiplexer;
	try {
		return mux ? mux.open(client.params.bouncerNetwork!, client) : new WebSocket(client.params.url);
	} catch (err) {
		console.error("Failed to create connection:", err);
		setTimeout(() => {
			client.dispatchError(new Error("Failed to create connection", { cause: err }));
			client.setStatus(ClientStatus.DISCONNECTED);
		}, 0);
		return null;
	}
}

/**
 * Listen to the events of a socket. Events of a socket we've already replaced
 * or closed are ignored: its state was reset when it stopped being the
 * current one.
 */
export function listenSocket(client: ClientConnection, ws: Socket): void {
	ws.addEventListener("open", () => {
		if (client.ws === ws) {
			client.handleOpen();
		}
	});

	ws.addEventListener("message", (e) => {
		if (client.ws !== ws) {
			return;
		}
		const event = e as MessageEvent;
		try {
			client.handleMessage(event);
		} catch (err) {
			// Skip the offending line instead of dropping the connection
			console.error("Failed to handle message:", event.data, err);
			client.dispatchError(err);
		}
	});

	ws.addEventListener("close", (event) => {
		client.handleClose(ws, (event as CloseEvent).code);
	});
}

/** Start registering: capability negotiation, password and identity. */
export function sendRegistration(client: ClientConnection, nick: string): void {
	client.send({ command: "CAP", params: ["LS", "302"] });
	if (client.params.pass) {
		client.send({ command: "PASS", params: [client.params.pass] });
	}
	client.send({ command: "NICK", params: [nick] });
	client.send({
		command: "USER",
		params: [client.params.username, "0", "*", client.params.realname],
	});
}

/** Reconnect after a delay, longer and longer after each failure. */
export function scheduleReconnect(client: ClientConnection): void {
	let delay = client.reconnectBackoff.next();
	const sinceLastReconnect = Date.now() - client.lastReconnectDate.getTime();
	if (sinceLastReconnect < RECONNECT_MIN_DELAY_MSEC) {
		delay = Math.max(delay, RECONNECT_MIN_DELAY_MSEC);
	}
	console.info("Reconnecting to server in " + delay / 1000 + " seconds");
	if (client.reconnectTimeoutID) {
		clearTimeout(client.reconnectTimeoutID);
	}
	client.reconnectTimeoutID = setTimeout(() => {
		client.reconnect();
	}, delay);
	client.setReconnectAt(Date.now() + delay);
}

export function reconnect(client: ClientConnection): void {
	const autoReconnect = client.autoReconnect;
	client.disconnect();
	client.autoReconnect = autoReconnect;

	client.setReconnectAt(null);
	if (client.params.multiplexer) {
		console.log("Attaching bouncer network " + client.params.bouncerNetwork);
	} else {
		console.log("Connecting to " + client.params.url);
	}
	client.setStatus(ClientStatus.CONNECTING);
	client.lastReconnectDate = new Date();

	const ws = openSocket(client);
	if (ws) {
		client.ws = ws;
		listenSocket(client, ws);
	}
}

export function resetConnection(client: ClientConnection): void {
	client.ws = null;
	client.setStatus(ClientStatus.DISCONNECTED);
	client.nick = null;
	client.serverPrefix = FALLBACK_SERVER_PREFIX;
	client.supportsCap = false;
	client.caps = new irc.CapRegistry();
	client.batches = new Map();
	client.multilineBatches = new Map();
	Object.keys(client.pendingCmds).forEach((k) => {
		client.pendingCmds[k] = Promise.resolve(null);
	});
	client.pendingSearch = null;
	client.isupport = new irc.Isupport();
	client.cm = irc.CaseMapping.RFC1459;
	client.monitored = new irc.CaseMapMap(null, client.cm);
	client.monitorLimit = Infinity;
	client.pendingLists = new irc.CaseMapMap(null, client.cm);
	client.whoxQueries = new Map();
	client.sentAway = null;
	clearTimeout(client.lagTimeoutID);
	client.setLag(null);
}

export function handleOpen(client: ClientConnection): void {
	console.log("Connection opened");
	client.setStatus(ClientStatus.REGISTERING);

	const mux = client.params.multiplexer;
	// An attached network shares the bouncer connection's socket, which
	// is kept alive by the bouncer connection
	client.setPingInterval(mux ? 0 : client.params.ping || 0);
	startRegistrationTimeout(client, client.ws!);

	client.nick = client.params.nick;

	if (mux) {
		// Registered by the bouncer once attached, with the caps of the
		// bouncer connection
		client.supportsCap = true;
		client.caps = mux.inheritedCaps();
		return;
	}

	sendRegistration(client, client.nick);
}
