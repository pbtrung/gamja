import type { ReactNode } from "react";
import useMediaQuery, { SMALL_SCREEN } from "./useMediaQuery";
import {
	CirclePlus,
	EllipsisVertical,
	LogOut,
	Menu as MenuIcon,
	PanelLeft,
	Plus,
	RotateCw,
	Search,
	Settings,
	SlidersHorizontal,
	Ban,
	Bell,
	BellOff,
	Pin,
	PinOff,
	Unplug,
	Users,
	X,
} from "lucide-react";
import { strip as stripANSI } from "../lib/ansi";
import { meaningfulRealname, unreadLabel } from "../format";
import BufferTypeIcon from "./BufferTypeIcon";
import {
	BufferType,
	ServerStatus,
	Unread,
	getServerName,
	getTargetMetadata,
	type Buffer,
	type BouncerNetwork,
	type Server,
	type TargetMetadata,
	type User,
} from "../state";
import RichText, { type LinkClickHandler } from "./RichText";
import Menu from "./Menu";
import ActionButton, { type Action } from "./header/ActionButton";
import Countdown from "./header/Countdown";
import UserDescription from "./header/UserDescription";

function formatLag(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export interface BufferHeaderProps {
	buffer: Buffer;
	server: Server;
	user: User | null;
	bouncerNetwork: BouncerNetwork | null;
	memberListHidden: boolean;
	/** Whether the side panels are open, on small screens */
	bufferListOpen: boolean;
	/** Buffer list hidden on large screens */
	bufferListHidden: boolean;
	memberListOpen: boolean;
	unreadElsewhere: Unread;
	onChannelClick: LinkClickHandler;
	onClose: () => void;
	/** Hide the channel without leaving it, on soju networks */
	onDetach?: () => void;
	/** Pin, mute or block the buffer, on soju networks */
	onSetMetadata?: (field: keyof TargetMetadata, value: boolean) => void;
	onJoin: () => void;
	onReconnect: () => void;
	onAddNetwork: () => void;
	onManageNetwork: () => void;
	onOpenSettings: () => void;
	/** Open message search, if supported */
	onSearch?: () => void;
	onOpenBufferList: () => void;
	onOpenMemberList: () => void;
}

export default function BufferHeader(props: BufferHeaderProps) {
	const { buffer, server, bouncerNetwork, user } = props;
	// Small screens only show the panel toggles and a menu with the rest
	const smallScreen = useMediaQuery(SMALL_SCREEN);

	let fullyConnected = server.status === ServerStatus.REGISTERED;
	if (bouncerNetwork) {
		fullyConnected = fullyConnected && bouncerNetwork.state === "connected";
	}

	let description: ReactNode = null;
	let descriptionTitle: string | undefined;
	const actions: Action[] = [];
	switch (buffer.type) {
		case BufferType.SERVER: {
			switch (server.status) {
				case ServerStatus.DISCONNECTED:
					description = server.reconnectAt ? (
						<>
							Disconnected, reconnecting in <Countdown to={server.reconnectAt} />
						</>
					) : (
						"Disconnected"
					);
					break;
				case ServerStatus.CONNECTING:
					description = "Connecting…";
					break;
				case ServerStatus.REGISTERING:
					description = "Logging in…";
					break;
				case ServerStatus.REGISTERED:
					if (bouncerNetwork) {
						switch (bouncerNetwork.state) {
							case "disconnected":
								description = "Bouncer disconnected from network";
								if (bouncerNetwork.error) {
									description += ": " + bouncerNetwork.error;
								}
								break;
							case "connecting":
								description = "Bouncer connecting to network…";
								break;
							case "connected":
								// host can be undefined e.g. when using UNIX domain sockets
								description = `Connected to ${bouncerNetwork.host || "network"}`;
								break;
						}
					} else if (buffer.serverInfo) {
						description = `Connected to ${buffer.serverInfo.name}`;
					} else {
						description = "Connected";
					}
					if (typeof description === "string" && typeof server.lag === "number") {
						description += ` · ${formatLag(server.lag)} lag`;
					}
					break;
			}

			// Labelled on wide screens, see .action-label
			const joinButton = {
				key: "join",
				icon: Plus,
				label: "Join channel",
				onClick: props.onJoin,
			};
			const reconnectButton = {
				key: "reconnect",
				icon: RotateCw,
				label: "Reconnect",
				onClick: props.onReconnect,
			};
			const settingsButton = {
				key: "settings",
				icon: Settings,
				label: "Settings",
				onClick: props.onOpenSettings,
			};

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
							onClick: props.onManageNetwork,
						});
					}
				} else {
					if (fullyConnected) {
						actions.push({
							key: "add",
							icon: CirclePlus,
							label: "Add network",
							onClick: props.onAddNetwork,
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
			break;
		}
		case BufferType.CHANNEL:
			if (buffer.topic) {
				descriptionTitle = stripANSI(buffer.topic);
				description = <RichText text={buffer.topic} onLinkClick={props.onChannelClick} />;
			}
			if (buffer.joined) {
				if (props.onDetach) {
					actions.push({
						key: "detach",
						icon: Unplug,
						label: "Detach",
						iconOnly: true,
						onClick: props.onDetach!,
					});
				}
				actions.push({
					key: "part",
					icon: LogOut,
					label: "Leave",
					danger: true,
					onClick: props.onClose,
				});
			} else {
				if (fullyConnected) {
					actions.push({
						key: "join",
						icon: Plus,
						label: "Join",
						iconOnly: true,
						onClick: props.onJoin,
					});
				}
				actions.push({ key: "part", icon: X, label: "Close", danger: true, onClick: props.onClose });
			}
			break;
		case BufferType.NICK: {
			if (user) {
				descriptionTitle = meaningfulRealname(user, buffer.name) ?? buffer.name;
				description = <UserDescription user={user} buffer={buffer} server={server} />;
			}

			actions.push({ key: "close", icon: X, label: "Close", danger: true, onClick: props.onClose });
			break;
		}
	}

	if (!actions.some((action) => action.key === "settings")) {
		actions.push({ key: "settings", icon: Settings, label: "Settings", onClick: props.onOpenSettings });
	}

	if (props.onSearch && buffer.type !== BufferType.SERVER) {
		actions.unshift({
			key: "search",
			icon: Search,
			label: "Search",
			iconOnly: true,
			onClick: props.onSearch,
		});
	}

	const setMetadata = props.onSetMetadata;
	if (setMetadata && buffer.type !== BufferType.SERVER) {
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
		actions.unshift(...toggles);
	}

	let name = buffer.name;
	if (buffer.type === BufferType.SERVER) {
		name = getServerName(server, bouncerNetwork);
	}

	if (typeof description === "string") {
		descriptionTitle = description;
	}

	// Panel toggles are only shown on small screens (or when the member
	// list is hidden via settings)
	const bufferListToggle = (
		<ActionButton
			key="buffer-list"
			// A drawer toggle on small screens, where the buffer list slides in
			icon={smallScreen || props.bufferListHidden ? MenuIcon : PanelLeft}
			label="Open buffer list"
			iconOnly
			className="buffer-list-toggle"
			description={unreadLabel(props.unreadElsewhere) ?? undefined}
			expanded={props.bufferListOpen}
			controls="buffer-list"
			onClick={props.onOpenBufferList}
		>
			{props.unreadElsewhere !== Unread.NONE ? (
				<span className={`unread-indicator unread-${props.unreadElsewhere}`} aria-hidden="true" />
			) : null}
		</ActionButton>
	);
	const memberListToggle =
		buffer.type === BufferType.CHANNEL ? (
			<ActionButton
				key="member-list"
				icon={Users}
				label="Open member list"
				iconOnly
				className={"member-list-toggle" + (props.memberListHidden ? " always" : "")}
				expanded={props.memberListOpen}
				controls="member-list"
				onClick={props.onOpenMemberList}
			/>
		) : null;

	// Small screens: [buffer list] [title and description] [menu] [member list]
	return (
		<>
			<div className="leading">{bufferListToggle}</div>
			<div className="title">
				<BufferTypeIcon type={buffer.type} className="title-icon" aria-hidden="true" />
				<h1 className="title-text" title={name}>
					{name}
				</h1>
			</div>
			{description ? (
				<div className="description" title={descriptionTitle}>
					{description}
				</div>
			) : null}
			<div className="actions">
				<div className="btn-group" role="group" aria-label="Buffer actions">
					{smallScreen ? (
						<>
							{actions.length > 0 && (
								<Menu
									items={actions}
									label="Buffer actions"
									toggleLabel="More actions"
									toggleIcon={EllipsisVertical}
								/>
							)}
							{memberListToggle}
						</>
					) : (
						<>
							{memberListToggle}
							{actions.map(({ key, ...action }) => (
								<ActionButton key={key} {...action} iconOnly />
							))}
						</>
					)}
				</div>
			</div>
		</>
	);
}
