/** Commands expecting a reply. */

import * as irc from "../irc";
import type { Message, OutgoingMessage } from "../irc";
import type { ClientConnection } from "./connection";
import { IRCError, TimeoutError } from "./errors";
import { ClientStatus } from "./types";

const ROUNDTRIP_TIMEOUT_MSEC = 60 * 1000;

let lastLabel = 0;

/* Execute a command that expects a response. `done` is called with message
 * events until it returns a truthy value. Gives up after `timeout` ms, so
 * that a lost reply can't block the commands queued behind it. */
export function roundtrip<T>(
	client: ClientConnection,
	msg: OutgoingMessage,
	done: (msg: Message) => T | undefined | void | false,
	timeout = ROUNDTRIP_TIMEOUT_MSEC,
): Promise<T> {
	const cmd = msg.command;

	let label: string | undefined;
	if (client.caps.enabled.has("labeled-response")) {
		lastLabel++;
		label = String(lastLabel);
		msg.tags = { ...msg.tags, label };
	}

	return new Promise((resolve, reject) => {
		const handleMessage = (msg: Message) => {
			const msgLabel = irc.getMessageLabel(msg);
			if (msgLabel && msgLabel !== label) {
				return;
			}

			let isError = false;
			switch (msg.command) {
				case "ACK":
					// labeled-response: the server had nothing to reply
					isError = label !== undefined && msgLabel === label;
					break;
				case "FAIL":
					isError = msg.params[0] === cmd;
					break;
				case irc.ERR_UNKNOWNERROR:
				case irc.ERR_UNKNOWNCOMMAND:
				case irc.ERR_NEEDMOREPARAMS:
				case irc.RPL_TRYAGAIN:
					isError = msg.params[1] === cmd;
					break;
			}
			if (isError) {
				removeEventListeners();
				// Reported by whoever made the request, not as a generic error
				msg.internal = true;
				reject(
					msg.command === "ACK"
						? new Error(`No reply from the server to ${cmd}`)
						: new IRCError(msg),
				);
				return;
			}

			let result;
			try {
				result = done(msg);
			} catch (err) {
				removeEventListeners();
				reject(err);
				return;
			}
			if (result) {
				removeEventListeners();
				resolve(result);
			}
		};

		const handleStatus = () => {
			if (client.status === ClientStatus.DISCONNECTED) {
				removeEventListeners();
				reject(new Error("Connection closed"));
			}
		};

		const timeoutID = setTimeout(() => {
			removeEventListeners();
			reject(new TimeoutError(`Timed out waiting for ${cmd}`));
		}, timeout);

		const removeEventListeners = () => {
			clearTimeout(timeoutID);
			client.roundtripHandlers.delete(handleMessage);
			client.removeEventListener("status", handleStatus);
		};

		// Handled before "message" listeners, to have the opportunity to
		// set the "internal" flag
		client.roundtripHandlers.add(handleMessage);
		client.addEventListener("status", handleStatus);
		try {
			client.send(msg);
		} catch (err) {
			removeEventListeners();
			reject(err);
		}
	});
}
