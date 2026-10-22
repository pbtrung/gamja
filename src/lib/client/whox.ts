/** WHO and WHOX replies. */

import * as irc from "../irc";
import type { Message } from "../irc";

// See https://github.com/quakenet/snircd/blob/master/doc/readme.who
// Sorted by order of appearance in RPL_WHOSPCRPL
export const WHOX_FIELDS = {
	channel: "c",
	username: "u",
	hostname: "h",
	server: "s",
	nick: "n",
	flags: "f",
	account: "a",
	realname: "r",
} as const;

export type WhoxField = keyof typeof WHOX_FIELDS;

export interface WhoReply {
	channel?: string;
	username?: string;
	hostname?: string;
	server?: string;
	nick: string;
	flags?: string;
	account?: string | null;
	realname?: string;
}

/**
 * Parse a WHO or WHOX reply. WHOX replies are matched to their query by
 * token, `queries` gives the fields of each query.
 */
export function parseWhoReply(msg: Message, queries: ReadonlyMap<string, string>): WhoReply {
	switch (msg.command) {
		case irc.RPL_WHOREPLY: {
			const last = msg.params[msg.params.length - 1];
			return {
				username: msg.params[2],
				hostname: msg.params[3],
				server: msg.params[4],
				nick: msg.params[5],
				flags: msg.params[6],
				realname: last.slice(last.indexOf(" ") + 1),
			};
		}
		case irc.RPL_WHOSPCRPL: {
			const token = msg.params[1];
			const fields = queries.get(token);
			if (!fields) {
				throw new Error("Unknown WHOX token: " + token);
			}
			const who: Record<string, string | null> = {};
			let i = 0;
			for (const [k, v] of Object.entries(WHOX_FIELDS)) {
				if (fields.indexOf(v) < 0) {
					continue;
				}

				who[k] = msg.params[2 + i];
				i++;
			}
			if (who.account === "0") {
				// WHOX uses "0" to mean "no account"
				who.account = null;
			}
			return who as unknown as WhoReply;
		}
		default:
			throw new Error("Not a WHO reply: " + msg.command);
	}
}
