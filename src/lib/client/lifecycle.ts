/** The steps of a connection's life: opening the socket, registering, reconnecting. */

import type { ClientConnection, Socket } from "./connection";
import { ClientStatus } from "./types";

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
