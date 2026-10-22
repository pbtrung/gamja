import { Bell, MessagesSquare, Palette, type LucideIcon } from "lucide-react";
import {
	BufferEventsDisplayMode,
	TEXT_SIZES,
	type MessageLayout,
	type NickAlign,
	type NotificationLevel,
} from "../../../state";

export type SettingsTab = "appearance" | "messages" | "notifications";

export const settingsTabs: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
	{ id: "appearance", label: "Appearance", icon: Palette },
	{ id: "messages", label: "Messages", icon: MessagesSquare },
	{ id: "notifications", label: "Notifications", icon: Bell },
];

export const layouts: { value: MessageLayout; label: string; hint: string }[] = [
	{
		value: "comfortable",
		label: "Comfortable",
		hint: "Messages grouped under the sender's name and avatar",
	},
	{
		value: "compact",
		label: "Compact",
		hint: "Classic IRC, one line per message",
	},
	{
		value: "columns",
		label: "Columns",
		hint: "WeeChat style, senders aligned in a column",
	},
	{
		value: "bubbles",
		label: "Bubbles",
		hint: "Messenger style, your messages on the right",
	},
];

export const nickAligns: { value: NickAlign; label: string }[] = [
	{ value: "right", label: "Right" },
	{ value: "left", label: "Left" },
];

export const nickColumnWidths: { value: number; label: string }[] = [8, 12, 16, 20].map((n) => ({
	value: n,
	label: String(n),
}));

export const textSizes: { value: number; label: string }[] = TEXT_SIZES.map((n) => ({
	value: n,
	label: `${n}%`,
}));

export const eventModes: { value: BufferEventsDisplayMode; label: string }[] = [
	{ value: BufferEventsDisplayMode.FOLD, label: "Fold" },
	{ value: BufferEventsDisplayMode.EXPAND, label: "Expand" },
	{ value: BufferEventsDisplayMode.HIDE, label: "Hide" },
];

export const notificationLevels: { value: NotificationLevel; label: string }[] = [
	{ value: "mentions", label: "Mentions" },
	{ value: "all", label: "All" },
	{ value: "none", label: "Off" },
];

export const autoAwayDelays: { value: number; label: string }[] = [
	{ value: 0, label: "Never" },
	{ value: 1, label: "1 min" },
	{ value: 5, label: "5 min" },
	{ value: 15, label: "15 min" },
];
