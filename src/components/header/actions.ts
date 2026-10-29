import {
	Ban,
	Bell,
	BellOff,
	CirclePlus,
	LogOut,
	Pin,
	PinOff,
	Plus,
	RotateCw,
	Search,
	Settings,
	SlidersHorizontal,
	Unplug,
	X,
} from "lucide-react";
import { BufferType, ServerStatus, getTargetMetadata, type Buffer, type Server } from "../../state";
import type { BufferHeaderProps } from "../BufferHeader";
import type { Action } from "./ActionButton";

type ActionHandlers = Pick<
	BufferHeaderProps,
	| "onClose"
	| "onDetach"
	| "onSetMetadata"
	| "onJoin"
	| "onReconnect"
	| "onAddNetwork"
	| "onManageNetwork"
	| "onOpenSettings"
	| "onSearch"
>;

/** Kept beside the overflow menu on desktop, for channels and users */
const MAIN_ACTIONS = ["join", "part", "close", "settings"];

function serverActions(server: Server, fullyConnected: boolean, handlers: ActionHandlers): Action[] {
	// Labelled on wide screens, see .action-label
	const joinButton = {
		key: "join",
		icon: Plus,
		label: "Join channel",
		onClick: handlers.onJoin,
	};
	const reconnectButton = {
		key: "reconnect",
		icon: RotateCw,
		label: "Reconnect",
		onClick: handlers.onReconnect,
	};
	const settingsButton = {
		key: "settings",
		icon: Settings,
		label: "Settings",
		onClick: handlers.onOpenSettings,
	};

	const actions: Action[] = [];
	if (server.isBouncer) {
		if (server.bouncerNetID) {
			if (fullyConnected) {
				actions.push(joinButton);
			}
			if (server.status === ServerStatus.REGISTERED) {
				actions.push({
					key: "manage",
					icon: SlidersHorizontal,
					label: "Manage network",
					onClick: handlers.onManageNetwork,
				});
			}
		} else {
			if (fullyConnected) {
				actions.push({
					key: "add",
					icon: CirclePlus,
					label: "Add network",
					onClick: handlers.onAddNetwork,
				});
			} else if (server.status === ServerStatus.DISCONNECTED) {
				actions.push(reconnectButton);
			}
			actions.push(settingsButton);
		}
	} else {
		if (fullyConnected) {
			actions.push(joinButton);
		} else if (server.status === ServerStatus.DISCONNECTED) {
			actions.push(reconnectButton);
		}
		actions.push(settingsButton);
	}
	return actions;
}

function channelActions(buffer: Buffer, fullyConnected: boolean, handlers: ActionHandlers): Action[] {
	const actions: Action[] = [];
	if (buffer.joined) {
		if (handlers.onDetach) {
			actions.push({
				key: "detach",
				icon: Unplug,
				label: "Detach",
				iconOnly: true,
				onClick: handlers.onDetach,
			});
		}
		actions.push({
			key: "part",
			icon: LogOut,
			label: "Leave",
			danger: true,
			onClick: handlers.onClose,
		});
	} else {
		if (fullyConnected) {
			actions.push({
				key: "join",
				icon: Plus,
				label: "Join",
				iconOnly: true,
				onClick: handlers.onJoin,
			});
		}
		actions.push({ key: "part", icon: X, label: "Close", danger: true, onClick: handlers.onClose });
	}
	return actions;
}

function nickActions(handlers: ActionHandlers): Action[] {
	return [{ key: "close", icon: X, label: "Close", danger: true, onClick: handlers.onClose }];
}

/** Pin, mute and, for users, block toggles */
function metadataToggles(
	buffer: Buffer,
	server: Server,
	setMetadata: NonNullable<ActionHandlers["onSetMetadata"]>,
): Action[] {
	const metadata = getTargetMetadata(server, buffer.name);
	const toggles: Action[] = [
		{
			key: "pin",
			icon: metadata.pinned ? PinOff : Pin,
			label: metadata.pinned ? "Unpin" : "Pin",
			iconOnly: true,
			onClick: () => setMetadata("pinned", !metadata.pinned),
		},
		{
			key: "mute",
			icon: metadata.muted ? Bell : BellOff,
			label: metadata.muted ? "Unmute" : "Mute",
			iconOnly: true,
			onClick: () => setMetadata("muted", !metadata.muted),
		},
	];
	if (buffer.type === BufferType.NICK) {
		toggles.push({
			key: "block",
			icon: Ban,
			label: metadata.blocked ? "Unblock" : "Block",
			iconOnly: true,
			onClick: () => setMetadata("blocked", !metadata.blocked),
		});
	}
	return toggles;
}

/** All the actions available on a buffer, in display order */
export function bufferActions(
	buffer: Buffer,
	server: Server,
	fullyConnected: boolean,
	handlers: ActionHandlers,
): Action[] {
	let actions: Action[] = [];
	switch (buffer.type) {
		case BufferType.SERVER:
			actions = serverActions(server, fullyConnected, handlers);
			break;
		case BufferType.CHANNEL:
			actions = channelActions(buffer, fullyConnected, handlers);
			break;
		case BufferType.NICK:
			actions = nickActions(handlers);
			break;
	}

	if (!actions.some((action) => action.key === "settings")) {
		actions.push({
			key: "settings",
			icon: Settings,
			label: "Settings",
			onClick: handlers.onOpenSettings,
		});
	}

	if (handlers.onSearch && buffer.type !== BufferType.SERVER) {
		actions.unshift({
			key: "search",
			icon: Search,
			label: "Search",
			iconOnly: true,
			onClick: handlers.onSearch,
		});
	}

	const setMetadata = handlers.onSetMetadata;
	if (setMetadata && buffer.type !== BufferType.SERVER) {
		actions.unshift(...metadataToggles(buffer, server, setMetadata));
	}
	return actions;
}

/**
 * Split the actions between the overflow menu and inline buttons: small
 * screens only have the menu, channels and users keep their main controls
 * beside it on desktop, servers have no menu.
 */
export function splitActions(
	actions: Action[],
	buffer: Buffer,
	smallScreen: boolean,
): { menuActions: Action[]; inlineActions: Action[] } {
	if (smallScreen) {
		return { menuActions: actions, inlineActions: [] };
	}
	if (buffer.type === BufferType.CHANNEL || buffer.type === BufferType.NICK) {
		return {
			menuActions: actions.filter((action) => !MAIN_ACTIONS.includes(action.key)),
			inlineActions: actions.filter((action) => MAIN_ACTIONS.includes(action.key)),
		};
	}
	return { menuActions: [], inlineActions: actions };
}
