/** User settings: their types, defaults and validation. */

export const BufferEventsDisplayMode = {
	FOLD: "fold",
	EXPAND: "expand",
	HIDE: "hide",
} as const;
export type BufferEventsDisplayMode = (typeof BufferEventsDisplayMode)[keyof typeof BufferEventsDisplayMode];

export const MESSAGE_LAYOUTS = ["comfortable", "compact", "columns", "bubbles"] as const;
export type MessageLayout = (typeof MESSAGE_LAYOUTS)[number];

/** Alignment of nicks in the sender column of the columns layout */
export const NICK_ALIGNS = ["right", "left"] as const;
export type NickAlign = (typeof NICK_ALIGNS)[number];

/** Fonts of the messages, see fonts.ts */
export const FONT_IDS = ["inter", "jetbrains-mono"] as const;
export type FontID = (typeof FONT_IDS)[number];

export interface Settings {
	/** Color theme ID, see themes.ts */
	theme: string;
	/** Extend the message input to the sides and bottom of the chat pane */
	edgeToEdgeInput: boolean;
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
	/** Font of the messages and the message input, see fonts.ts */
	messagesFont: FontID;
	/** Text size of the messages, in pixels, see messageTextSize() */
	messageTextSize: number;
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
	/** Load the missed messages of channels other than the active one when
	 * they are opened, rather than on reconnect */
	lazyBacklog: boolean;
}

export const NOTIFICATION_LEVELS = ["mentions", "all", "none"] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export const defaultSettings: Settings = {
	theme: "dracula",
	edgeToEdgeInput: true,
	layout: "columns",
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
	messagesFont: "inter",
	messageTextSize: 15,
	showTyping: true,
	sendTyping: true,
	bufferEvents: BufferEventsDisplayMode.FOLD,
	showMemberList: false,
	pushNotifications: false,
	notifications: "mentions",
	autoAwayMinutes: 1,
	backlogSize: 200,
	lazyBacklog: true,
};

export const TEXT_SIZE_MIN = 10;
export const TEXT_SIZE_MAX = 24;

/** The message text size, falling back to the default for an invalid
 * stored value. */
export function messageTextSize(settings: Settings): number {
	const size = settings.messageTextSize;
	return Number.isInteger(size) && size >= TEXT_SIZE_MIN && size <= TEXT_SIZE_MAX
		? size
		: defaultSettings.messageTextSize;
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

/** Allowed values of the settings which are strings, when restricted */
const SETTING_VALUES: Partial<Record<keyof Settings, readonly string[]>> = {
	layout: MESSAGE_LAYOUTS,
	nickAlign: NICK_ALIGNS,
	notifications: NOTIFICATION_LEVELS,
	bufferEvents: Object.values(BufferEventsDisplayMode),
	messagesFont: FONT_IDS,
};

/**
 * The valid settings of stored ones, e.g. from localStorage: unknown keys
 * and values of the wrong type are dropped, the defaults apply to them. A
 * stored value isn't trusted: it may come from an older or newer gamja.
 */
export function sanitizeSettings(stored: unknown): Partial<Settings> {
	if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
		return {};
	}
	const settings: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(stored)) {
		if (!Object.hasOwn(defaultSettings, k)) {
			continue;
		}
		const key = k as keyof Settings;
		if (typeof v !== typeof defaultSettings[key]) {
			continue;
		}
		if (typeof v === "number" && !Number.isFinite(v)) {
			continue;
		}
		const allowed = SETTING_VALUES[key];
		if (allowed && !allowed.includes(v as string)) {
			continue;
		}
		settings[key] = v;
	}
	return settings as Partial<Settings>;
}
