/** User settings: their types, defaults and validation. */

export const BufferEventsDisplayMode = {
	FOLD: "fold",
	EXPAND: "expand",
	HIDE: "hide",
} as const;
export type BufferEventsDisplayMode = (typeof BufferEventsDisplayMode)[keyof typeof BufferEventsDisplayMode];

export type MessageLayout = "comfortable" | "compact" | "columns" | "bubbles";

/** Alignment of nicks in the sender column of the columns layout */
export type NickAlign = "right" | "left";

export interface Settings {
	/** Color theme ID, see themes.ts */
	theme: string;
	/**
	 * Comfortable groups messages under the sender's name, compact is classic
	 * IRC, columns aligns senders like WeeChat, bubbles is messenger-style
	 */
	layout: MessageLayout;
	/** Color nicks, in all layouts (WeeChat's nick colors) */
	nickColors: boolean;
	/** Show the sender's channel membership prefix, e.g. "@", before its nick
	 * in the compact and columns layouts (WeeChat's weechat.look.nick_mode) */
	nickModes: boolean;
	/** Columns layout: alignment of the sender column (weechat.look.prefix_align) */
	nickAlign: NickAlign;
	/** Columns layout: width of the sender column, in characters
	 * (weechat.look.prefix_align_max) */
	nickColumnWidth: number;
	/** Columns layout: leave the sender out of consecutive messages from the
	 * same sender (weechat.look.prefix_same_nick) */
	hideRepeatedNicks: boolean;
	/** Columns layout: "<nick>" instead of "nick" (weechat.look.nick_prefix
	 * and nick_suffix) */
	nickBrackets: boolean;
	secondsInTimestamps: boolean;
	/** Show the time of messages, in all layouts */
	showTimestamps: boolean;
	/** Show a separator between messages of different days */
	dateSeparators: boolean;
	/** Compact layout: indent the wrapped lines of a long message */
	indentWrapped: boolean;
	/** Show timestamps as 01:34 PM instead of 13:34 */
	clock12h: boolean;
	/** Text size of the whole interface, in percent, see textSize() */
	textSize: number;
	/** Show who is typing in the current buffer */
	showTyping: boolean;
	/** Let others know when we type, with +typing client tags */
	sendTyping: boolean;
	bufferEvents: BufferEventsDisplayMode;
	showMemberList: boolean;
	/** Receive Web Push notifications when gamja is closed */
	pushNotifications: boolean;
	/** Which messages show a desktop notification */
	notifications: NotificationLevel;
	/** Mark the user away after the page stays hidden this long, 0 to never */
	autoAwayMinutes: number;
	/** How many of the latest missed messages to load per buffer on
	 * reconnect, see backlogSize(). Older ones are loaded on demand. */
	backlogSize: number;
}

export type NotificationLevel = "mentions" | "all" | "none";

export const defaultSettings: Settings = {
	theme: "dracula",
	layout: "compact",
	nickColors: true,
	nickModes: false,
	nickAlign: "right",
	nickColumnWidth: 12,
	hideRepeatedNicks: false,
	nickBrackets: false,
	secondsInTimestamps: true,
	showTimestamps: true,
	dateSeparators: true,
	indentWrapped: false,
	clock12h: false,
	textSize: 100,
	showTyping: true,
	sendTyping: true,
	bufferEvents: BufferEventsDisplayMode.FOLD,
	showMemberList: false,
	pushNotifications: false,
	notifications: "mentions",
	autoAwayMinutes: 1,
	backlogSize: 200,
};

/** Values of the textSize setting */
export const TEXT_SIZES = [90, 100, 110, 125] as const;

/** The textSize setting, falling back to the default for a stored value
 * that isn't one of TEXT_SIZES. */
export function textSize(settings: Settings): number {
	return (TEXT_SIZES as readonly number[]).includes(settings.textSize)
		? settings.textSize
		: defaultSettings.textSize;
}

/** Bounds of the backlogSize setting */
export const BACKLOG_SIZE_MIN = 100;
export const BACKLOG_SIZE_MAX = 4000;

/** The backlogSize setting, falling back to the default for a stored value
 * that isn't a number, and kept within bounds. */
export function backlogSize(settings: Settings): number {
	const n = Math.trunc(settings.backlogSize);
	if (!Number.isFinite(n)) {
		return defaultSettings.backlogSize;
	}
	return Math.min(Math.max(n, BACKLOG_SIZE_MIN), BACKLOG_SIZE_MAX);
}
