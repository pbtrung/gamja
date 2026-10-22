import { createContext } from "react";
import type { Message } from "../../lib/irc";
import type { Buffer, BouncerNetwork, Server, Settings } from "../../state";
import type { LinkClickHandler } from "../RichText";

export interface MessageActionHandlers {
	myNick: string | null;
	canReact: boolean;
	canReply: boolean;
	canRedact: boolean;
	onReact: (msg: Message, emoji: string) => void;
	onReply: (msg: Message) => void;
	onRedact: (msg: Message) => void;
}

export interface MessageListHandlers {
	actions?: MessageActionHandlers;
	onChannelClick: LinkClickHandler;
	onNickClick: (nick: string) => void;
	onAuthClick: () => void;
	onRegisterClick: () => void;
	onVerifyClick: (account: string, message: string) => void;
	onRetryHistory?: () => void;
	/** Fetch the missed messages of the buffer's gap */
	onLoadGap?: () => void;
}

export interface Context extends MessageListHandlers {
	buffer: Buffer;
	server: Server;
	bouncerNetwork: BouncerNetwork | null;
	settings: Settings;
}

/** Whether timestamps use a 12-hour clock, see Settings.clock12h */
export const Clock12hContext = createContext(false);
