import { memo, type MouseEvent } from "react";
import { BellOff, Pin } from "lucide-react";
import { meaningfulRealname, unreadLabel } from "../format";
import BufferTypeIcon from "./BufferTypeIcon";
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
	onClick: (buf: Buffer) => void;
	onClose: (buf: Buffer) => void;
}

const BufferItem = memo(function BufferItem({
	buffer,
	server,
	bouncerNetwork,
	active,
	onClick,
	onClose,
}: BufferItemProps) {
	function handleClick(event: MouseEvent) {
		event.preventDefault();
		onClick(buffer);
	}
	function handleMouseDown(event: MouseEvent) {
		if (event.button === 1) {
			// middle click
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
				aria-selected={active}
				aria-current={active ? "page" : undefined}
				aria-description={
					[
						buffer.type === BufferType.SERVER
							? connectionLabel[connectionStatus(server, bouncerNetwork)]
							: null,
						unreadLabel(buffer.unread),
						metadata.pinned ? "Pinned" : null,
						metadata.muted ? "Muted" : null,
					]
						.filter(Boolean)
						.join(", ") || undefined
				}
				onClick={handleClick}
				onMouseDown={handleMouseDown}
			>
				<BufferTypeIcon type={buffer.type} className="buffer-icon" aria-hidden="true" />
				<span className="buffer-name">{name}</span>
				{metadata.muted && <BellOff className="buffer-flag" aria-hidden="true" />}
				{metadata.pinned && <Pin className="buffer-flag" aria-hidden="true" />}
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
	onBufferClick: (buf: Buffer) => void;
	onBufferClose: (buf: Buffer) => void;
}

/**
 * Buffers in display order: pinned ones right after their server's buffer,
 * keeping the order of the others.
 */
function displayOrder(buffers: Map<number, Buffer>, servers: Map<number, Server>): Buffer[] {
	const pinned = (buf: Buffer) =>
		buf.type !== BufferType.SERVER &&
		Boolean(getTargetMetadata(servers.get(buf.server), buf.name).pinned);
	const groups = new Map<number, Buffer[]>();
	for (const buf of buffers.values()) {
		groups.set(buf.server, [...(groups.get(buf.server) ?? []), buf]);
	}
	return [...groups.values()].flatMap((group) => [
		...group.filter((buf) => buf.type === BufferType.SERVER),
		...group.filter(pinned),
		...group.filter((buf) => buf.type !== BufferType.SERVER && !pinned(buf)),
	]);
}

export default function BufferList(props: BufferListProps) {
	const items = displayOrder(props.buffers, props.servers).map((buf) => {
		const server = props.servers.get(buf.server);
		if (!server) {
			return null;
		}

		const bouncerNetwork = server.bouncerNetID
			? (props.bouncerNetworks.get(server.bouncerNetID) ?? null)
			: null;

		return (
			<BufferItem
				key={buf.id}
				buffer={buf}
				server={server}
				bouncerNetwork={bouncerNetwork}
				onClick={props.onBufferClick}
				onClose={props.onBufferClose}
				active={props.activeBuffer === buf.id}
			/>
		);
	});

	return (
		<ul className="buffer-items" role="tablist" aria-label="Buffer list" aria-orientation="vertical">
			{items}
		</ul>
	);
}
