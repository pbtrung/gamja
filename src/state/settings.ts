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

export const NOTIFICATION_LEVELS = ["mentions", "all", "none"] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export const defaultSettings: Settings = {
	theme: "dracula",
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

/** Allowed values of the settings which are strings, when restricted */
const SETTING_VALUES: Partial<Record<keyof Settings, readonly string[]>> = {
	layout: MESSAGE_LAYOUTS,
	nickAlign: NICK_ALIGNS,
	notifications: NOTIFICATION_LEVELS,
	bufferEvents: Object.values(BufferEventsDisplayMode),
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
