/** Types and constants shared by the client modules. */

import type { Batch, Message } from "../irc";
import type { Multiplexer } from "./multiplex";
import type { SASLOAuthBearer, SASLPlain } from "./sasl";

export const ClientStatus = {
	DISCONNECTED: "disconnected",
	CONNECTING: "connecting",
	REGISTERING: "registering",
	REGISTERED: "registered",
} as const;

export type ClientStatus = (typeof ClientStatus)[keyof typeof ClientStatus];

export interface ClientParams {
	url: string;
	username: string;
	realname: string;
	nick: string;
	pass?: string | null;
	saslPlain?: SASLPlain | null;
	saslExternal?: boolean;
	saslOauthBearer?: SASLOAuthBearer | null;
	bouncerNetwork?: string | null;
	/** For a bouncer network: attach it to the bouncer connection of this multiplexer */
	multiplexer?: Multiplexer | null;
	ping?: number;
	eventPlayback?: boolean;
	autojoin?: string[];
}

export interface MessageEventDetail {
	message: Message;
	batch: Batch | null;
}

export interface BatchResult extends Batch {
	messages: Message[];
}

export interface ChatHistoryTarget {
	name: string;
	latestMessage: string;
}

export type BouncerNetworkAttrs = Record<string, string | null | undefined>;
