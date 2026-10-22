/** Capability negotiation and SASL messages. */

import * as base64 from "../base64";
import type { Message, OutgoingMessage } from "./message";
import { splitKeyValue } from "./util";

export class CapRegistry {
	available = new Map<string, string>();
	enabled = new Set<string>();
	/** Caps requested and not rejected nor removed since, maybe pending */
	requested = new Set<string>();

	addAvailable(s: string): void {
		for (const item of s.split(" ")) {
			if (!item) {
				continue;
			}
			const [k, v] = splitKeyValue(item);
			this.available.set(k.toLowerCase(), v);
		}
	}

	parse(msg: Message): void {
		if (msg.command !== "CAP") {
			return;
		}

		const subCmd = msg.params[1];
		const args = msg.params.slice(2);
		// The list of caps, missing in a malformed message
		const list = args[args.length - 1] ?? "";
		switch (subCmd) {
			case "LS":
			case "NEW":
				this.addAvailable(list);
				break;
			case "DEL":
				for (let cap of list.split(" ")) {
					cap = cap.toLowerCase();
					this.available.delete(cap);
					this.enabled.delete(cap);
					this.requested.delete(cap);
				}
				break;
			case "ACK":
				for (let cap of list.split(" ")) {
					cap = cap.toLowerCase();
					if (!cap) {
						continue;
					}
					if (cap.startsWith("-")) {
						this.enabled.delete(cap.slice(1));
						this.requested.delete(cap.slice(1));
					} else {
						this.enabled.add(cap);
					}
				}
				break;
			case "NAK":
				// Can be requested again if the server advertises it anew
				for (const cap of list.split(" ")) {
					this.requested.delete(cap.toLowerCase());
				}
				break;
		}
	}

	/**
	 * CAP REQ messages for the available caps not requested yet. A REQ is all
	 * or nothing: sasl gets its own so that another rejected cap can't take
	 * it down, and long lists are split to stay well below the line length.
	 */
	requestAvailable(l: string[]): OutgoingMessage[] {
		l = l.filter((cap) => {
			return this.available.has(cap) && !this.enabled.has(cap) && !this.requested.has(cap);
		});
		for (const cap of l) {
			this.requested.add(cap);
		}

		const groups: string[][] = [];
		if (l.includes("sasl")) {
			groups.push(["sasl"]);
			l = l.filter((cap) => cap !== "sasl");
		}
		let group: string[] = [];
		let len = 0;
		for (const cap of l) {
			if (group.length > 0 && len + cap.length + 1 > maxCapReqLength) {
				groups.push(group);
				group = [];
				len = 0;
			}
			group.push(cap);
			len += cap.length + 1;
		}
		if (group.length > 0) {
			groups.push(group);
		}
		return groups.map((caps) => ({ command: "CAP", params: ["REQ", caps.join(" ")] }));
	}
}

const maxSASLLength = 400;

const maxCapReqLength = 400;

export function generateAuthenticateMessages(payload: string): OutgoingMessage[] {
	const encoded = base64.encode(payload);

	// <= instead of < because we need to send a final empty response if the
	// last chunk is exactly 400 bytes long
	const msgs: OutgoingMessage[] = [];
	for (let i = 0; i <= encoded.length; i += maxSASLLength) {
		const chunk = encoded.substring(i, i + maxSASLLength);
		msgs.push({ command: "AUTHENTICATE", params: [chunk || "+"] });
	}

	return msgs;
}
