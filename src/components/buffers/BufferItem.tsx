import { memo, type KeyboardEvent, type MouseEvent } from "react";
import { BellOff, ChevronDown, ChevronRight, Pin } from "lucide-react";
import { meaningfulRealname, unreadLabel } from "../../format";
import BufferTypeIcon from "../BufferTypeIcon";
import {
	BufferType,
	Unread,
	ServerStatus,
	getBufferURL,
	getServerName,
	getTargetMetadata,
	type Buffer,
	type BouncerNetwork,
	type Server,
} from "../../state";

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
				{buffer.unread !== Unread.NONE ? (
					<span className="unread-indicator" aria-hidden="true" />
				) : null}
			</a>
		</li>
	);
});

export default BufferItem;
