/** Redaction of credentials from the debug log of sent messages. */

import type { OutgoingMessage } from "../irc";

const REDACTED = "<redacted>";
// AUTHENTICATE parameters worth logging: mechanism names, empty responses,
// aborts. Anything else is a base64-encoded credential.
const SASL_LOGGABLE = /^(\+|\*|PLAIN|EXTERNAL|OAUTHBEARER|SCRAM-[A-Z0-9-]+)$/;

/** Hide passwords, SASL payloads and verification codes from debug logs. */
export function redactForLog(msg: OutgoingMessage): OutgoingMessage {
	const params = msg.params ?? [];
	switch (msg.command.toUpperCase()) {
		case "PASS":
			return { ...msg, params: params.map(() => REDACTED) };
		case "AUTHENTICATE":
			return { ...msg, params: params.map((p) => (SASL_LOGGABLE.test(String(p)) ? p : REDACTED)) };
		case "REGISTER":
		case "VERIFY":
			// REGISTER <account> <email> <password>, VERIFY <account> <code>
			return { ...msg, params: params.map((p, i) => (i === params.length - 1 ? REDACTED : p)) };
	}
	return msg;
}
