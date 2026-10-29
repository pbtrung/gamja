/** Keeping the connection alive: pings, lag checks and timeouts. */

import type { Message } from "../irc";
import type { ClientConnection, Socket } from "./connection";
import { WEBSOCKET_CLOSE_CODES } from "./errors";
import { ClientStatus } from "./types";

export const LAG_FIRST_DELAY_MSEC = 2 * 1000;
const LAG_INTERVAL_MSEC = 30 * 1000;
const LAG_TOKEN_PREFIX = "gamja-lag-";
// Without a PONG by then, the connection is considered dead: browsers take a
// long time to notice a TCP connection silently dropped by the network
const PONG_TIMEOUT_MSEC = 60 * 1000;
const REGISTRATION_TIMEOUT_MSEC = 60 * 1000;

/**
 * Measure the lag now and then, the PONG tells how long it took. This also
 * checks that the connection is alive: the PONG must come in time.
 */
export function scheduleLagCheck(client: ClientConnection, delay: number): void {
	clearTimeout(client.lagTimeoutID);
	client.lagTimeoutID = setTimeout(() => {
		const ws = client.ws;
		if (client.status !== ClientStatus.REGISTERED || !ws) {
			return;
		}
		client.send({ command: "PING", params: [LAG_TOKEN_PREFIX + Date.now()] });
		// Cleared by the PONG, which schedules the next check
		client.lagTimeoutID = setTimeout(() => {
			client.handlePongTimeout(ws);
		}, PONG_TIMEOUT_MSEC);
	}, delay);
}

export function handlePongTimeout(client: ClientConnection, ws: Socket): void {
	if (client.ws !== ws) {
		return;
	}
	console.warn(`No PONG in ${PONG_TIMEOUT_MSEC / 1000} seconds, dropping the connection`);
	client.dropConnection(ws, WEBSOCKET_CLOSE_CODES.ABNORMAL_CLOSURE);
}

/** Measure the lag if the PONG replies to one of our lag checks. */
export function handlePong(client: ClientConnection, msg: Message): void {
	const token = msg.params[1] ?? "";
	if (!token.startsWith(LAG_TOKEN_PREFIX)) {
		return;
	}
	const sent = parseInt(token.slice(LAG_TOKEN_PREFIX.length), 10);
	if (!Number.isNaN(sent)) {
		client.setLag(Math.max(0, Date.now() - sent));
	}
	client.scheduleLagCheck(LAG_INTERVAL_MSEC);
}

/**
 * The PONG checks only start once registered: a server or proxy which never
 * replies would leave us registering forever. Cleared on RPL_WELCOME by
 * scheduleLagCheck().
 */
export function startRegistrationTimeout(client: ClientConnection, ws: Socket): void {
	clearTimeout(client.lagTimeoutID);
	client.lagTimeoutID = setTimeout(() => {
		if (client.ws === ws && client.status !== ClientStatus.REGISTERED) {
			console.warn(
				`Not registered in ${REGISTRATION_TIMEOUT_MSEC / 1000} seconds, dropping the connection`,
			);
			client.dropConnection(ws, WEBSOCKET_CLOSE_CODES.ABNORMAL_CLOSURE);
		}
	}, REGISTRATION_TIMEOUT_MSEC);
}

export function setPingInterval(client: ClientConnection, sec: number): void {
	if (client.pingIntervalID) {
		clearInterval(client.pingIntervalID);
	}
	client.pingIntervalID = null;

	if (sec <= 0) {
		return;
	}

	client.pingIntervalID = setInterval(() => {
		if (client.ws) {
			client.send({ command: "PING", params: ["gamja"] });
		}
	}, sec * 1000);
}
