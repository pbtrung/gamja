/** The types of the application state, and their constants. */

import type * as irc from "../lib/irc";
import type { CaseMapFn, Message, MembershipMode } from "../lib/irc";
import { ClientStatus } from "../lib/client";
import type { Settings } from "./settings";

export const SERVER_BUFFER = "*";

export const BufferType = {
	SERVER: "server",
	CHANNEL: "channel",
	NICK: "nick",
} as const;
export type BufferType = (typeof BufferType)[keyof typeof BufferType];

export const ServerStatus = ClientStatus;
export type ServerStatus = ClientStatus;

export const Unread = {
	NONE: "",
	MESSAGE: "message",
	HIGHLIGHT: "highlight",
} as const;
export type Unread = (typeof Unread)[keyof typeof Unread];

const unreadPriority: Record<Unread, number> = {
	[Unread.NONE]: 0,
	[Unread.MESSAGE]: 1,
	[Unread.HIGHLIGHT]: 2,
};

export function compareUnread(a: Unread, b: Unread): number {
	return unreadPriority[a] - unreadPriority[b];
}

export function unionUnread(a: Unread, b: Unread): Unread {
	return compareUnread(a, b) > 0 ? a : b;
}

export const ReceiptType = {
	DELIVERED: "delivered",
	READ: "read",
} as const;
export type ReceiptType = (typeof ReceiptType)[keyof typeof ReceiptType];

export interface Receipt {
	time: string;
}

/** A position in a buffer's history, e.g. a CHATHISTORY bound. */
export interface HistoryBound {
	time: string;
	msgid?: string;
}

/**
 * Messages missed while disconnected which weren't fetched, between two
 * loaded messages. Bounds are exclusive.
 */
export interface HistoryGap {
	after: HistoryBound;
	before: HistoryBound;
	status: "idle" | "loading" | "error";
}

/** Actions on channel members, from the member list */
export type MemberAction =
	"message" | "whois" | "op" | "deop" | "voice" | "devoice" | "kick" | "ban" | "kickban";

export interface User {
	nick: string;
	username?: string;
	hostname?: string;
	realname?: string;
	account?: string | null;
	away?: boolean;
	offline?: boolean;
	operator?: boolean;
	bot?: boolean;
}

export interface Server {
	id: number;
	/** From ISUPPORT NETWORK */
	name: string | null;
	status: ServerStatus;
	cm: CaseMapFn;
	users: irc.CaseMapMap<User>;
	account: string | null;
	supportsSASLPlain: boolean;
	supportsAccountRegistration: boolean;
	reliableUserAccounts: boolean;
	/** From ISUPPORT STATUSMSG */
	statusMsg: string | null;
	/** From ISUPPORT PREFIX */
	membershipModes: MembershipMode[] | null;
	isBouncer: boolean;
	bouncerNetID: string | null;
	/** Our current nickname */
	nick: string | null;
	/** Optional features supported by the server */
	features: Features;
	/** Per-target settings synced by soju (draft/metadata-2), by target name */
	metadata: irc.CaseMapMap<TargetMetadata>;
	/** Round-trip time to the server in ms, unknown if null or missing */
	lag?: number | null;
	/** When the next reconnection attempt happens, in ms since the epoch */
	reconnectAt?: number | null;
}

/** soju's metadata keys: https://soju.im/ext/metadata */
export interface TargetMetadata {
	/** Displayed more prominently than other buffers */
	pinned?: boolean;
	/** Displayed less prominently, without notifications */
	muted?: boolean;
	/** Messages from this user are hidden */
	blocked?: boolean;
}

export const METADATA_KEYS: Record<keyof TargetMetadata, string> = {
	pinned: "soju.im/pinned",
	muted: "soju.im/muted",
	blocked: "soju.im/blocked",
};

export interface Features {
	reactions: boolean;
	replies: boolean;
	typing: boolean;
	redaction: boolean;
	search: boolean;
	webPush: boolean;
	/** Pinning, muting and blocking synced by soju */
	targetMetadata: boolean;
}

export const noFeatures: Features = {
	reactions: false,
	replies: false,
	typing: false,
	redaction: false,
	search: false,
	webPush: false,
	targetMetadata: false,
};

interface ServerInfo {
	name: string;
	version: string;
}

export interface Buffer {
	id: number;
	name: string;
	type: BufferType;
	server: number;
	/** If server buffer */
	serverInfo: ServerInfo | null;
	/** If channel */
	joined: boolean;
	topic: string | null;
	hasInitialWho: boolean;
	/** Whether a NAMES reply has been received, if channel */
	hasNames: boolean;
	/** Nick → membership prefixes, if channel */
	members: irc.CaseMapMap<string>;
	messages: Message[];
	/** msgids of deleted messages */
	redacted: Set<string>;
	/** msgid → emoji → nicks who reacted */
	reactions: Map<string, Map<string, string[]>>;
	/** Users currently typing, by nick */
	typing: Map<string, TypingState>;
	/** Chat history status: unknown before the first fetch, end once all fetched */
	history: "unknown" | "loading" | "more" | "end" | "error";
	/** Missed messages not fetched yet, if any */
	gap: HistoryGap | null;
	unread: Unread;
	prevReadReceipt: Receipt | null;
}

interface TypingState {
	status: "active" | "paused";
	/** When the status was received, in milliseconds since the epoch */
	time: number;
}

/** How long typing notifications stay valid without updates, per the +typing spec */
export const TYPING_TIMEOUT = { active: 6000, paused: 30000 } as const;

export type BouncerNetwork = Record<string, string | null | undefined>;

export interface State {
	servers: Map<number, Server>;
	buffers: Map<number, Buffer>;
	activeBuffer: number | null;
	bouncerNetworks: Map<string, BouncerNetwork>;
	settings: Settings;
}

/** Identifies a buffer, either by ID or by server and name. */
export type BufferID = number | { id?: number; server?: number | null; name?: string | null } | Buffer;

type Update<S> = Partial<S> | undefined | null | void;
export type Updater<S> = Update<S> | ((s: S) => Update<S>);
