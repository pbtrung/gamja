/** Channel members: their nicks and membership prefixes. */

import * as irc from "../lib/irc";
import type Client from "../lib/client";
import type { Buffer, State } from "./model";

/**
 * Change the members of a channel, and those of the NAMES reply being
 * received if any: the reply predates the change.
 */
export function editMembers(
	buf: Buffer,
	edit: (members: irc.CaseMapMap<string>) => void,
): Pick<Buffer, "members" | "pendingMembers"> {
	const members = new irc.CaseMapMap(buf.members);
	edit(members);
	let pendingMembers = buf.pendingMembers;
	if (pendingMembers) {
		pendingMembers = new irc.CaseMapMap(pendingMembers);
		edit(pendingMembers);
	}
	return { members, pendingMembers };
}

/** Rename a nick in the channels of a server, or remove it with null. */
export function renameMember(state: State, serverID: number, nick: string, newNick: string | null): State {
	let buffers: Map<number, Buffer> | null = null;
	for (const buf of state.buffers.values()) {
		if (buf.server !== serverID || !(buf.members.has(nick) || buf.pendingMembers?.has(nick))) {
			continue;
		}
		// Only copy the buffers if a channel changes: a new map re-renders
		// everything showing buffers
		buffers ??= new Map(state.buffers);
		const update = editMembers(buf, (members) => {
			const membership = members.get(nick);
			if (membership === undefined) {
				return;
			}
			members.delete(nick);
			if (newNick !== null) {
				members.set(newNick, membership);
			}
		});
		buffers.set(buf.id, { ...buf, ...update });
	}
	return buffers ? { ...state, buffers } : state;
}

/** Add or remove a membership prefix, keeping them sorted by privilege. */
export function updateMembership(membership: string, letter: string, add: boolean, client: Client): string {
	const membershipModes = client.isupport.membershipModes();

	const prefixPrivs = new Map(
		membershipModes.map((membership, i) => {
			return [membership.prefix, i];
		}),
	);

	if (add) {
		const i = membership.indexOf(letter);
		if (i < 0) {
			membership += letter;
			membership = Array.from(membership)
				.sort((a, b) => {
					return (prefixPrivs.get(a) ?? 0) - (prefixPrivs.get(b) ?? 0);
				})
				.join("");
		}
	} else {
		membership = membership.replace(letter, "");
	}

	return membership;
}
