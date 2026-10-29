import { Bell, Info, MessagesSquare, Palette, Type, type LucideIcon } from "lucide-react";
import {
	BufferEventsDisplayMode,
	MESSAGE_LAYOUTS,
	NICK_ALIGNS,
	NOTIFICATION_LEVELS,
	type MessageLayout,
	type NickAlign,
	type NotificationLevel,
} from "../../../state";

export type SettingsTab = "appearance" | "font" | "messages" | "notifications" | "about";

export const settingsTabs: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
	{ id: "appearance", label: "Appearance", icon: Palette },
	{ id: "font", label: "Font", icon: Type },
	{ id: "messages", label: "Messages", icon: MessagesSquare },
	{ id: "notifications", label: "Notifications", icon: Bell },
	{ id: "about", label: "About", icon: Info },
];

// Labels are keyed by value: a value added to the settings without a label
// doesn't compile. The lists keep the settings' order.
const layoutLabels: Record<MessageLayout, { label: string; hint: string }> = {
	comfortable: {
		label: "Comfortable",
		hint: "Messages grouped under the sender's name and avatar",
	},
	compact: { label: "Compact", hint: "Classic IRC, one line per message" },
	columns: { label: "Columns", hint: "WeeChat style, senders aligned in a column" },
	bubbles: { label: "Bubbles", hint: "Messenger style, your messages on the right" },
};

export const layouts = MESSAGE_LAYOUTS.map((value) => ({ value, ...layoutLabels[value] }));

const nickAlignLabels: Record<NickAlign, string> = { right: "Right", left: "Left" };

export const nickAligns = NICK_ALIGNS.map((value) => ({ value, label: nickAlignLabels[value] }));

export const nickColumnWidths: { value: number; label: string }[] = [8, 12, 16, 20].map((n) => ({
	value: n,
	label: String(n),
}));

export const eventModes: { value: BufferEventsDisplayMode; label: string }[] = [
	{ value: BufferEventsDisplayMode.FOLD, label: "Fold" },
	{ value: BufferEventsDisplayMode.EXPAND, label: "Expand" },
	{ value: BufferEventsDisplayMode.HIDE, label: "Hide" },
];

const notificationLevelLabels: Record<NotificationLevel, string> = {
	mentions: "Mentions",
	all: "All",
	none: "Off",
};

export const notificationLevels = NOTIFICATION_LEVELS.map((value) => ({
	value,
	label: notificationLevelLabels[value],
}));

export const autoAwayDelays: { value: number; label: string }[] = [
	{ value: 0, label: "Never" },
	{ value: 1, label: "1 min" },
	{ value: 5, label: "5 min" },
	{ value: 15, label: "15 min" },
];
