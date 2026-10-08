import type { ReactNode } from "react";
import {
	CirclePlus,
	LogOut,
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
	type LucideIcon,
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

const UserStatus = {
	HERE: "here",
	GONE: "gone",
	OFFLINE: "offline",
} as const;
type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

const statusText: Record<UserStatus, string> = {
	here: "User is online",
	gone: "User is away",
	offline: "User is offline",
};

function NickStatus({ status }: { status: UserStatus }) {
	return (
		<span
			className={`status status-${status}`}
			title={statusText[status]}
			role="img"
			aria-label={statusText[status]}
		/>
	);
}

interface ActionButtonProps {
	icon: LucideIcon;
	label: string;
	danger?: boolean;
	iconOnly?: boolean;
	className?: string;
	/** Extra information for assistive technologies */
	description?: string;
	onClick: () => void;
	children?: ReactNode;
}

function ActionButton({
	icon: Icon,
	label,
	danger,
	iconOnly,
	className,
	description,
	onClick,
	children,
}: ActionButtonProps) {
	return (
		<button
			type="button"
			className={`btn btn-sm ${danger ? "btn-danger-outline" : ""} ${className || ""}`}
			title={label}
			aria-label={iconOnly ? label : undefined}
			aria-description={description}
			onClick={onClick}
		>
			<Icon aria-hidden="true" />
			{iconOnly ? null : <span className="action-label">{label}</span>}
			{children}
		</button>
	);
}

export interface BufferHeaderProps {
	buffer: Buffer;
	server: Server;
	user: User | null;
	bouncerNetwork: BouncerNetwork | null;
	memberListHidden: boolean;
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

	let fullyConnected = server.status === ServerStatus.REGISTERED;
	if (bouncerNetwork) {
		fullyConnected = fullyConnected && bouncerNetwork.state === "connected";
	}

	let description: ReactNode = null;
	let descriptionTitle: string | undefined;
	const actions: ReactNode[] = [];
	switch (buffer.type) {
		case BufferType.SERVER: {
			switch (server.status) {
				case ServerStatus.DISCONNECTED:
					description = "Disconnected";
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
					break;
			}

			const joinButton = (
				<ActionButton key="join" icon={Plus} label="Join channel" onClick={props.onJoin} />
			);
			const reconnectButton = (
				<ActionButton key="reconnect" icon={RotateCw} label="Reconnect" onClick={props.onReconnect} />
			);
			const settingsButton = (
				<ActionButton
					key="settings"
					icon={Settings}
					label="Settings"
					onClick={props.onOpenSettings}
				/>
			);

			if (server.isBouncer) {
				if (server.bouncerNetID) {
					if (fullyConnected) {
						actions.push(joinButton);
					}
					if (server.status === ServerStatus.REGISTERED) {
						actions.push(
							<ActionButton
								key="manage"
								icon={SlidersHorizontal}
								label="Manage network"
								onClick={props.onManageNetwork}
							/>,
						);
					}
				} else {
					if (fullyConnected) {
						actions.push(
							<ActionButton
								key="add"
								icon={CirclePlus}
								label="Add network"
								onClick={props.onAddNetwork}
							/>,
						);
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
					actions.push(
						<ActionButton key="detach" icon={Unplug} label="Detach" onClick={props.onDetach} />,
					);
				}
				actions.push(
					<ActionButton key="part" icon={LogOut} label="Leave" danger onClick={props.onClose} />,
				);
			} else {
				if (fullyConnected) {
					actions.push(<ActionButton key="join" icon={Plus} label="Join" onClick={props.onJoin} />);
				}
				actions.push(
					<ActionButton key="part" icon={X} label="Close" danger onClick={props.onClose} />,
				);
			}
			break;
		case BufferType.NICK: {
			if (user) {
				let status: UserStatus = UserStatus.HERE;
				if (user.offline) {
					status = UserStatus.OFFLINE;
				} else if (user.away) {
					status = UserStatus.GONE;
				}

				const realname = meaningfulRealname(user, buffer.name) ?? buffer.name;

				const details: ReactNode[] = [];
				if (user.username && user.hostname) {
					details.push(`${user.username}@${user.hostname}`);
				}
				if (user.account) {
					const desc = `This user is verified and has logged in to the server with the account ${user.account}.`;
					const item =
						user.account === buffer.name ? "authenticated" : `authenticated as ${user.account}`;
					details.push(
						<abbr key="account" title={desc}>
							{item}
						</abbr>,
					);
				} else if (server.reliableUserAccounts) {
					// If the server supports MONITOR and WHOX, we can faithfully
					// keep user.account up-to-date for user queries
					details.push(
						<abbr key="account" title="This user has not been verified and is not logged in.">
							unauthenticated
						</abbr>,
					);
				}
				if (user.operator) {
					details.push(
						<abbr
							key="oper"
							title="This user is a server operator, they have administrator privileges."
						>
							server operator
						</abbr>,
					);
				}
				if (user.bot) {
					details.push(
						<abbr key="bot" title="This user is an automated bot.">
							bot
						</abbr>,
					);
				}

				descriptionTitle = realname;
				description = (
					<>
						<NickStatus status={status} /> {realname}
						{details.length > 0 && (
							<> ({details.flatMap((d, i) => (i === 0 ? [d] : [", ", d]))})</>
						)}
					</>
				);
			}

			actions.push(<ActionButton key="close" icon={X} label="Close" danger onClick={props.onClose} />);
			break;
		}
	}

	if (props.onSearch && buffer.type !== BufferType.SERVER) {
		actions.unshift(
			<ActionButton key="search" icon={Search} label="Search" iconOnly onClick={props.onSearch} />,
		);
	}

	const setMetadata = props.onSetMetadata;
	if (setMetadata && buffer.type !== BufferType.SERVER) {
		const metadata = getTargetMetadata(server, buffer.name);
		const toggles: ReactNode[] = [
			<ActionButton
				key="pin"
				icon={metadata.pinned ? PinOff : Pin}
				label={metadata.pinned ? "Unpin" : "Pin"}
				iconOnly
				onClick={() => setMetadata("pinned", !metadata.pinned)}
			/>,
			<ActionButton
				key="mute"
				icon={metadata.muted ? Bell : BellOff}
				label={metadata.muted ? "Unmute" : "Mute"}
				iconOnly
				onClick={() => setMetadata("muted", !metadata.muted)}
			/>,
		];
		if (buffer.type === BufferType.NICK) {
			toggles.push(
				<ActionButton
					key="block"
					icon={Ban}
					label={metadata.blocked ? "Unblock" : "Block"}
					iconOnly
					onClick={() => setMetadata("blocked", !metadata.blocked)}
				/>,
			);
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
	const toggles: ReactNode[] = [
		<ActionButton
			key="buffer-list"
			icon={PanelLeft}
			label="Open buffer list"
			iconOnly
			className="buffer-list-toggle"
			description={unreadLabel(props.unreadElsewhere) ?? undefined}
			onClick={props.onOpenBufferList}
		>
			{props.unreadElsewhere !== Unread.NONE ? (
				<span className={`unread-indicator unread-${props.unreadElsewhere}`} aria-hidden="true" />
			) : null}
		</ActionButton>,
	];
	if (buffer.type === BufferType.CHANNEL) {
		toggles.push(
			<ActionButton
				key="member-list"
				icon={Users}
				label="Open member list"
				iconOnly
				className={"member-list-toggle" + (props.memberListHidden ? " always" : "")}
				onClick={props.onOpenMemberList}
			/>,
		);
	}

	return (
		<>
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
			<div className="actions btn-group" role="group" aria-label="Buffer actions">
				{toggles}
				{actions}
			</div>
		</>
	);
}
