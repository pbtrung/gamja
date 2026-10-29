/** Helpers shared by the state updates from incoming IRC messages. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import type { Buffer, State, Updater, User } from "./model";
import { updateBuffer, updateServer, updateState } from "./buffers";

/** Updates the state according to an incoming IRC message. */
export type MessageHandler = (
	state: State,
	msg: Message,
	serverID: number,
	client: Client,
) => Partial<State> | undefined;

/** The prefix of a message, "*" if it has none. */
export function getPrefix(msg: Message): irc.Prefix {
	return msg.prefix ?? { name: "*" };
}

/** Merge an update into the state, for messages changing several things. */
export function applyUpdate(state: State, update: Partial<State> | undefined): State {
	return { ...state, ...update };
}

export function updateTarget(
	state: State,
	serverID: number,
	name: string | undefined,
	updater: Updater<Buffer>,
): Partial<State> | undefined {
	// A missing name would select the server buffer, see getBuffer(): ignore
	// messages missing their target instead, e.g. malformed replies
	return name ? updateBuffer(state, { server: serverID, name }, updater) : undefined;
}

export function updateUser(
	state: State,
	serverID: number,
	name: string,
	updater: Updater<User>,
): Partial<State> | undefined {
	return updateServer(state, serverID, (server) => {
		const users = new irc.CaseMapMap(server.users);
		const updated = updateState(users.get(name) ?? ({ nick: name } as User), updater);
		if (!updated) {
			return;
		}
		users.set(name, updated);
		return { users };
	});
}
