/** MONITOR: the targets whose presence the server notifies us about. */

import * as irc from "../irc";
import type { Message } from "../irc";
import type { ClientConnection } from "./connection";

/** Send the pending monitored targets, as far as the server's limit allows. */
export function sendPendingMonitor(client: ClientConnection): void {
	let room = Math.min(client.isupport.monitor(), client.monitorLimit);
	const pending: string[] = [];
	for (const [target, sent] of client.monitored) {
		if (sent) {
			room--;
		} else {
			pending.push(target);
		}
	}
	const targets = pending.slice(0, Math.max(0, room));
	if (targets.length === 0) {
		return;
	}
	for (const target of targets) {
		client.monitored.set(target, true);
	}
	for (const chunk of irc.chunkTargets(targets, client.isupport.targMax("MONITOR"))) {
		client.send({ command: "MONITOR", params: ["+", chunk.join(",")] });
	}
}

/**
 * Handle ERR_MONLISTFULL. The list is shorter than advertised, e.g. shared
 * with other clients by a bouncer: wait for unmonitor() to make room.
 */
export function handleMonListFull(client: ClientConnection, msg: Message): void {
	for (const target of (msg.params[2] ?? "").split(",")) {
		if (client.monitored.has(target)) {
			client.monitored.set(target, false);
		}
	}
	client.monitorLimit = Array.from(client.monitored.values()).filter((sent) => sent).length;
	msg.internal = true;
}
