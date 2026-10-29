/**
 * State updates from incoming IRC messages, handled by command family in
 * ./handle-*.ts.
 */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import type { State } from "./model";
import type { MessageHandler } from "./handle-common";
import { channelHandlers } from "./handle-channels";
import { serverHandlers } from "./handle-server";
import { userHandlers } from "./handle-users";

export { handleRedact } from "./handle-channels";

const handlers = new Map<string, MessageHandler>([...serverHandlers, ...channelHandlers, ...userHandlers]);

/** Update the state according to an incoming IRC message. */
export function handleMessage(
	state: State,
	msg: Message,
	serverID: number,
	client: Client,
): Partial<State> | undefined {
	// Don't update our internal state if it's a chat history message
	if (irc.findBatchByType(msg, "chathistory")) {
		return;
	}
	return handlers.get(msg.command)?.(state, msg, serverID, client);
}
