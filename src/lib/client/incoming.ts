/** Incoming messages: parsing, batches, and the commands the connection handles. */

import * as irc from "../irc";
import type { Message, Batch } from "../irc";
import type { ClientConnection } from "./connection";
import { WEBSOCKET_CLOSE_CODES, IRCError } from "./errors";
import { handlePong, LAG_FIRST_DELAY_MSEC } from "./keepalive";
import { handleMonListFull } from "./monitor";
import { ClientStatus, type MessageEventDetail } from "./types";

export function handleMessage(client: ClientConnection, event: MessageEvent): void {
	if (typeof event.data !== "string") {
		console.error("Received unsupported data type:", event.data);
		// Browsers don't let clients close with 1003, only 1000 and 3000-4999
		client.dropConnection(client.ws!, WEBSOCKET_CLOSE_CODES.UNSUPPORTED_DATA);
		return;
	}

	const raw = event.data;
	if (client.debug) {
		console.debug("Received:", raw);
	}

	// A line of a network attached to this bouncer connection
	if (client.multiplexer?.route(raw)) {
		return;
	}

	const msg = client.assembleMultiline(irc.parseMessage(raw));
	if (!msg) {
		return;
	}

	// If the prefix is missing, assume it's coming from the server on the
	// other end of the connection
	if (!msg.prefix) {
		msg.prefix = client.serverPrefix;
	}

	const msgBatch = lookupBatch(client, msg);
	const endedBatch = msg.command === "BATCH" ? handleBatch(client, msg, msgBatch) : null;

	if (!handleCommand(client, msg)) {
		return;
	}

	dispatchMessage(client, msg, msgBatch);

	// Delete after firing the message event so that handlers can access
	// the batch
	if (endedBatch) {
		client.batches.delete(endedBatch);
	}
}

/** Find the batch a message is part of, and attach it to the message. */
function lookupBatch(client: ClientConnection, msg: Message): Batch | null {
	const batchTag = msg.tags["batch"];
	if (!batchTag) {
		return null;
	}
	const msgBatch = client.batches.get(batchTag) || null;
	if (msgBatch) {
		msg.batch = msgBatch;
	}
	return msgBatch;
}

/** Start a batch, or return the name of the batch the message ends. */
function handleBatch(client: ClientConnection, msg: Message, parent: Batch | null): string | null {
	const { start, name } = irc.parseBatchRef(msg);
	if (!start) {
		return name;
	}
	const batch: Batch = {
		name,
		type: msg.params[1],
		params: msg.params.slice(2),
		tags: msg.tags,
		parent,
	};
	client.batches.set(name, batch);
	return null;
}

/**
 * Pending roundtrips first: they may mark the message as internal. A capture
 * listener wouldn't do: browsers call the listeners of a plain EventTarget in
 * the order they were added.
 */
function dispatchMessage(client: ClientConnection, msg: Message, batch: Batch | null): void {
	// Copied, handlers remove themselves once done
	if (client.roundtripHandlers.size > 0) {
		for (const handler of [...client.roundtripHandlers]) {
			handler(msg);
		}
	}
	client.dispatchEvent(
		new CustomEvent<MessageEventDetail>("message", {
			detail: { message: msg, batch },
		}),
	);
}

/**
 * Update the connection state from a message. Returns false if the message
 * must not be dispatched, the connection being dropped.
 */
function handleCommand(client: ClientConnection, msg: Message): boolean {
	switch (msg.command) {
		case irc.RPL_WELCOME:
			return handleWelcome(client, msg);
		case irc.RPL_ISUPPORT: {
			const tokens = msg.params.slice(1, -1);
			client.isupport.parse(tokens);
			client.updateCaseMapping();
			// The server may have started supporting MONITOR
			client.sendPendingMonitor();
			break;
		}
		case irc.ERR_MONLISTFULL:
			handleMonListFull(client, msg);
			break;
		case "CAP":
			client.handleCap(msg);
			break;
		case irc.RPL_LOGGEDIN:
			console.log("Logged in");
			break;
		case irc.RPL_LOGGEDOUT:
			console.log("Logged out");
			break;
		case "PING":
			// The token is required, but some servers omit it
			client.send({ command: "PONG", params: msg.params.slice(0, 1) });
			break;
		case "PONG":
			handlePong(client, msg);
			break;
		case "NICK":
			if (client.isMyNick(msg.prefix!.name)) {
				client.nick = msg.params[0];
			}
			break;
		case "ERROR":
			handleErrorCommand(client, msg);
			break;
		case irc.ERR_PASSWDMISMATCH:
		case irc.ERR_ERRONEUSNICKNAME:
		case irc.ERR_NICKNAMEINUSE:
		case irc.ERR_NICKCOLLISION:
		case irc.ERR_UNAVAILRESOURCE:
		case irc.ERR_NOPERMFORHOST:
		case irc.ERR_YOUREBANNEDCREEP:
			client.dispatchError(new IRCError(msg));
			if (client.status !== ClientStatus.REGISTERED) {
				client.disconnect();
			}
			break;
		case "FAIL":
			handleFail(client, msg);
			break;
		default:
			handleListReply(client, msg);
			break;
	}
	return true;
}

function handleWelcome(client: ClientConnection, msg: Message): boolean {
	if (client.wantsSASL() && !client.supportsCap) {
		client.dispatchError(new Error("Server doesn't support SASL"));
		client.disconnect();
		return false;
	}

	if (msg.prefix) {
		client.serverPrefix = msg.prefix;
	}
	client.nick = msg.params[0];

	console.log("Registration complete");
	// Not on open: a gateway may accept the socket, then fail to reach the
	// IRC server, and must be retried less and less
	client.reconnectBackoff.reset();
	client.setStatus(ClientStatus.REGISTERED);
	// Restore the away status without draft/pre-away
	client.syncAway();
	client.scheduleLagCheck(LAG_FIRST_DELAY_MSEC);
	return true;
}

/**
 * Sent before closing the link, e.g. on server restarts and ping timeouts:
 * keep reconnecting. Fatal registration errors come before, as numerics.
 */
function handleErrorCommand(client: ClientConnection, msg: Message): void {
	client.dispatchError(new IRCError(msg));
	const ws = client.ws;
	if (ws) {
		client.dropConnection(ws, WEBSOCKET_CLOSE_CODES.NORMAL_CLOSURE);
	}
}

/** Disconnect on the FAIL replies which prevent registration. */
function handleFail(client: ClientConnection, msg: Message): void {
	if (client.status === ClientStatus.REGISTERED) {
		return;
	}
	if (msg.params[0] === "BOUNCER" && msg.params[2] === "BIND") {
		client.dispatchError(
			new Error("Failed to bind to bouncer network", {
				cause: new IRCError(msg),
			}),
		);
		client.disconnect();
	}
	if (msg.params[1] === "ACCOUNT_REQUIRED") {
		client.dispatchError(new IRCError(msg));
		client.disconnect();
	}
}

/** Collect the replies of NAMES, WHOIS and WHO into their end reply. */
function handleListReply(client: ClientConnection, msg: Message): void {
	switch (msg.command) {
		case irc.RPL_NAMREPLY:
			client.pushPendingList("NAMES " + msg.params[2], msg);
			break;
		case irc.RPL_ENDOFNAMES:
			client.endPendingList("NAMES " + msg.params[1], msg);
			break;
		case irc.RPL_WHOISUSER:
		case irc.RPL_WHOISSERVER:
		case irc.RPL_WHOISOPERATOR:
		case irc.RPL_WHOISIDLE:
		case irc.RPL_WHOISCHANNELS:
		case irc.RPL_WHOISACCOUNT:
			client.pushPendingList("WHOIS " + msg.params[1], msg);
			break;
		case irc.RPL_ENDOFWHOIS:
			client.endPendingList("WHOIS " + msg.params[1], msg);
			break;
		case irc.RPL_WHOREPLY:
		case irc.RPL_WHOSPCRPL:
			client.pushPendingList("WHO", msg);
			break;
		case irc.RPL_ENDOFWHO:
			client.endPendingList("WHO", msg);
			break;
	}
}
