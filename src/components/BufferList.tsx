import { memo, type KeyboardEvent, type MouseEvent } from "react";
import { BellOff, ChevronDown, ChevronRight, Pin } from "lucide-react";
import { meaningfulRealname, unreadLabel } from "../format";
import BufferTypeIcon from "./BufferTypeIcon";
import {
	BufferType,
	Unread,
	ServerStatus,
	getBufferURL,
	getServerKey,
	getServerName,
	getTargetMetadata,
	type Buffer,
	type BouncerNetwork,
	type Server,
} from "../state";

type ConnectionStatus = "connected" | "connecting" | "disconnected";

const connectionLabel: Record<ConnectionStatus, string> = {
	connected: "Connected",
	connecting: "Connecting",
	disconnected: "Disconnected",
};

function connectionStatus(server: Server, bouncerNetwork: BouncerNetwork | null): ConnectionStatus {
	if (server.status === ServerStatus.DISCONNECTED) {
		return "disconnected";
	}
	if (server.status !== ServerStatus.REGISTERED) {
		return "connecting";
	}
	if (bouncerNetwork) {
		switch (bouncerNetwork.state) {
			case "connecting":
				return "connecting";
			case "disconnected":
				return "disconnected";
		}
	}
	return "connected";
}

interface BufferItemProps {
	buffer: Buffer;
	server: Server;
	bouncerNetwork: BouncerNetwork | null;
	active: boolean;
	/** Whether Tab reaches the item: only one does, arrow keys move between them */
	tabStop: boolean;
	/** For server buffers: whether the network's buffers are collapsed */
	collapsed?: boolean;
	/** For collapsed server buffers: how many hidden buffers are unread */
	hiddenUnread?: number;
	onClick: (buf: Buffer) => void;
	onClose: (buf: Buffer) => void;
	/** For server buffers: collapse or expand, all networks with all */
	onToggleCollapse?: (buf: Buffer, all: boolean) => void;
}

const BufferItem = memo(function BufferItem({
	buffer,
	server,
	bouncerNetwork,
	active,
	tabStop,
	collapsed,
	hiddenUnread,
	onClick,
	onClose,
	onToggleCollapse,
}: BufferItemProps) {
	function handleClick(event: MouseEvent) {
		event.preventDefault();
		onClick(buffer);
	}
	function handleToggleClick(event: MouseEvent) {
		// Part of the tab, but doesn't switch to the buffer
		event.preventDefault();
		event.stopPropagation();
		onToggleCollapse?.(buffer, event.altKey);
	}
	function handleKeyDown(event: KeyboardEvent) {
		// Like a tree: left collapses, right expands
		if (
			onToggleCollapse &&
			((event.key === "ArrowLeft" && !collapsed) || (event.key === "ArrowRight" && collapsed))
		) {
			event.preventDefault();
			onToggleCollapse(buffer, event.altKey);
		} else if (event.key === " ") {
			// Links only activate on Enter, tabs on Space too
			event.preventDefault();
			onClick(buffer);
		}
	}
	// Middle click closes the buffer
	function handleMouseDown(event: MouseEvent) {
		if (event.button === 1) {
			// Don't start autoscrolling
			event.preventDefault();
		}
	}
	function handleAuxClick(event: MouseEvent) {
		if (event.button === 1) {
			// Don't open the link in a new tab
			event.preventDefault();
			onClose(buffer);
		}
	}

	let name = buffer.name;
	if (buffer.type === BufferType.SERVER) {
		name = getServerName(server, bouncerNetwork);
	}

	let title: string | undefined;
	const classes = ["type-" + buffer.type];
	if (active) {
		classes.push("active");
	}
	const metadata = buffer.type === BufferType.SERVER ? {} : getTargetMetadata(server, buffer.name);
	if (metadata.muted) {
		classes.push("muted");
	}
	if (buffer.unread !== Unread.NONE) {
		classes.push("unread-" + buffer.unread);
	}
	switch (buffer.type) {
		case BufferType.SERVER: {
			const isError = server.status === ServerStatus.DISCONNECTED || Boolean(bouncerNetwork?.error);
			if (isError) {
				classes.push("error");
			}
			break;
		}
		case BufferType.NICK: {
			const user = server.users.get(name);
			title = meaningfulRealname(user, name) ?? undefined;
			if (user?.offline) {
				classes.push("offline");
			}
			break;
		}
		case BufferType.CHANNEL:
			if (!buffer.joined) {
				classes.push("parted");
			}
			break;
	}

	return (
		<li className={classes.join(" ")} role="presentation">
			<a
				href={getBufferURL(buffer, bouncerNetwork)}
				title={title}
				role="tab"
				tabIndex={tabStop ? 0 : -1}
				aria-selected={active}
				aria-expanded={onToggleCollapse ? !collapsed : undefined}
				aria-description={
					[
						buffer.type === BufferType.SERVER
							? connectionLabel[connectionStatus(server, bouncerNetwork)]
							: null,
						unreadLabel(buffer.unread),
						hiddenUnread
							? `${hiddenUnread} more unread ${hiddenUnread === 1 ? "buffer" : "buffers"}`
							: null,
						metadata.pinned ? "Pinned" : null,
						metadata.muted ? "Muted" : null,
					]
						.filter(Boolean)
						.join(", ") || undefined
				}
				onClick={handleClick}
				onMouseDown={handleMouseDown}
				onAuxClick={handleAuxClick}
				onKeyDown={handleKeyDown}
			>
				{onToggleCollapse ? (
					<span
						className="buffer-collapse"
						title={
							collapsed
								? "Expand (Alt-click: all networks)"
								: "Collapse (Alt-click: all networks)"
						}
						aria-hidden="true"
						onClick={handleToggleClick}
					>
						{collapsed ? <ChevronRight /> : <ChevronDown />}
					</span>
				) : (
					<BufferTypeIcon type={buffer.type} className="buffer-icon" aria-hidden="true" />
				)}
				<span className="buffer-name">{name}</span>
				{metadata.muted && <BellOff className="buffer-flag" aria-hidden="true" />}
				{metadata.pinned && <Pin className="buffer-flag" aria-hidden="true" />}
				{hiddenUnread ? (
					<span className="buffer-count" aria-hidden="true">
						{hiddenUnread}
					</span>
				) : null}
				{buffer.type === BufferType.SERVER && (
					<span
						className={`connection-status status-${connectionStatus(server, bouncerNetwork)}`}
						aria-hidden="true"
						title={connectionLabel[connectionStatus(server, bouncerNetwork)]}
					/>
				)}
				{buffer.unread !== Unread.NONE ? (
					<span className="unread-indicator" aria-hidden="true" />
				) : null}
			</a>
		</li>
	);
});

interface BufferListProps {
	buffers: Map<number, Buffer>;
	servers: Map<number, Server>;
	bouncerNetworks: Map<string, BouncerNetwork>;
	activeBuffer: number | null;
	/** Keys of the networks whose buffers are collapsed, see getServerKey() */
	collapsed?: ReadonlySet<string>;
	onBufferClick: (buf: Buffer) => void;
	onBufferClose: (buf: Buffer) => void;
	onToggleCollapse?: (buf: Buffer, all: boolean) => void;
}

interface Group {
	server: Buffer[];
	/** Buffers shown */
	shown: Buffer[];
	/** How many buffers hidden by collapsing have unread messages */
	hiddenUnread: number;
}

/**
 * Buffers in display order, by server: pinned ones right after their
 * server's buffer, keeping the order of the others. Collapsed servers only
 * show pinned buffers, the active one and those with highlights: hidden
 * ones never have highlights.
 */
function displayGroups(
	buffers: Map<number, Buffer>,
	servers: Map<number, Server>,
	collapsed: ReadonlySet<string>,
	activeBuffer: number | null,
): Group[] {
	const pinned = (buf: Buffer) =>
		buf.type !== BufferType.SERVER &&
		Boolean(getTargetMetadata(servers.get(buf.server), buf.name).pinned);
	const byServer = new Map<number, Buffer[]>();
	for (const buf of buffers.values()) {
		byServer.set(buf.server, [...(byServer.get(buf.server) ?? []), buf]);
	}
	return [...byServer].map(([serverID, group]) => {
		const server = servers.get(serverID);
		const children = [
			...group.filter(pinned),
			...group.filter((buf) => buf.type !== BufferType.SERVER && !pinned(buf)),
		];
		const isCollapsed = server !== undefined && collapsed.has(getServerKey(server));
		const visible = (buf: Buffer) =>
			!isCollapsed || pinned(buf) || buf.id === activeBuffer || buf.unread === Unread.HIGHLIGHT;
		return {
			server: group.filter((buf) => buf.type === BufferType.SERVER),
			shown: children.filter(visible),
			hiddenUnread: children.filter(
				(buf) =>
					!visible(buf) && buf.unread !== Unread.NONE && !getTargetMetadata(server, buf.name).muted,
			).length,
		};
	});
}

const noneCollapsed: ReadonlySet<string> = new Set();

/**
 * Move the focus between tabs with the arrow keys, Home and End. Unlike
 * the settings tabs, this doesn't switch buffers: switching moves the
 * focus to the composer, and marks the buffers passed by as read.
 */
function handleListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
	const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=tab]")];
	const i = tabs.indexOf(document.activeElement as HTMLElement);
	const moves: Record<string, number> = {
		ArrowDown: i + 1,
		ArrowUp: i - 1,
		Home: 0,
		End: tabs.length - 1,
	};
	if (i < 0 || !(event.key in moves) || event.altKey || event.ctrlKey || event.metaKey) {
		return;
	}
	event.preventDefault();
	tabs[(moves[event.key] + tabs.length) % tabs.length].focus();
}

export default function BufferList(props: BufferListProps) {
	const collapsed = props.collapsed ?? noneCollapsed;
	const groups = displayGroups(props.buffers, props.servers, collapsed, props.activeBuffer);
	const shown = groups.flatMap((group) => [...group.server, ...group.shown]);
	// The active buffer is the one Tab reaches, or the first one if none
	const tabStop = shown.some((buf) => buf.id === props.activeBuffer) ? props.activeBuffer : shown[0]?.id;
	const items = groups.flatMap((group) =>
		[...group.server, ...group.shown].map((buf) => {
			const server = props.servers.get(buf.server);
			if (!server) {
				return null;
			}

			const bouncerNetwork = server.bouncerNetID
				? (props.bouncerNetworks.get(server.bouncerNetID) ?? null)
				: null;

			const isServer = buf.type === BufferType.SERVER;
			const isCollapsed = isServer && collapsed.has(getServerKey(server));

			return (
				<BufferItem
					key={buf.id}
					buffer={buf}
					server={server}
					bouncerNetwork={bouncerNetwork}
					onClick={props.onBufferClick}
					onClose={props.onBufferClose}
					active={props.activeBuffer === buf.id}
					tabStop={tabStop === buf.id}
					collapsed={isServer ? isCollapsed : undefined}
					hiddenUnread={isCollapsed ? group.hiddenUnread : undefined}
					onToggleCollapse={isServer ? props.onToggleCollapse : undefined}
				/>
			);
		}),
	);

	return (
		<ul
			className="buffer-items"
			role="tablist"
			aria-label="Buffer list"
			aria-orientation="vertical"
			onKeyDown={handleListKeyDown}
		>
			{items}
		</ul>
	);
}
