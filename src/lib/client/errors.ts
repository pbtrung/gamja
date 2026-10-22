/** Errors reported by the client. */

import type { Message } from "../irc";

// WebSocket status codes
// https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1
export const WEBSOCKET_CLOSE_CODES = {
	NORMAL_CLOSURE: 1000,
	GOING_AWAY: 1001,
	PROTOCOL_ERROR: 1002,
	UNSUPPORTED_DATA: 1003,
	NO_STATUS_CODE: 1005,
	ABNORMAL_CLOSURE: 1006,
	INVALID_FRAME_PAYLOAD_DATA: 1007,
	POLICY_VIOLATION: 1008,
	MESSAGE_TOO_BIG: 1009,
	MISSING_MANDATORY_EXT: 1010,
	INTERNAL_SERVER_ERROR: 1011,
	TLS_HANDSHAKE_FAILED: 1015,
};

const WEBSOCKET_CLOSE_CODE_NAMES: Record<number, string> = {
	[WEBSOCKET_CLOSE_CODES.GOING_AWAY]: "going away",
	[WEBSOCKET_CLOSE_CODES.PROTOCOL_ERROR]: "protocol error",
	[WEBSOCKET_CLOSE_CODES.UNSUPPORTED_DATA]: "unsupported data",
	[WEBSOCKET_CLOSE_CODES.NO_STATUS_CODE]: "no status code received",
	[WEBSOCKET_CLOSE_CODES.ABNORMAL_CLOSURE]: "abnormal closure",
	[WEBSOCKET_CLOSE_CODES.INVALID_FRAME_PAYLOAD_DATA]: "invalid frame payload data",
	[WEBSOCKET_CLOSE_CODES.POLICY_VIOLATION]: "policy violation",
	[WEBSOCKET_CLOSE_CODES.MESSAGE_TOO_BIG]: "message too big",
	[WEBSOCKET_CLOSE_CODES.MISSING_MANDATORY_EXT]: "missing mandatory extension",
	[WEBSOCKET_CLOSE_CODES.INTERNAL_SERVER_ERROR]: "internal server error",
	[WEBSOCKET_CLOSE_CODES.TLS_HANDSHAKE_FAILED]: "TLS handshake failed",
};

export class IRCError extends Error {
	msg: Message;

	constructor(msg: Message) {
		let text;
		if (msg.params.length > 0) {
			// IRC errors have a human-readable message as last param
			text = msg.params[msg.params.length - 1];
		} else {
			text = `unknown error (${msg.command})`;
		}
		super(text);

		this.msg = msg;
	}
}

/** The server didn't reply in time, which may just be a slow connection. */
export class TimeoutError extends Error {}

export class WebSocketError extends Error {
	constructor(code: number) {
		let text = "Connection error";
		const name = WEBSOCKET_CLOSE_CODE_NAMES[code];
		if (name) {
			text += " (" + name + ")";
		}

		super(text);
	}
}
