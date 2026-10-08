import { memo, type MouseEvent } from "react";
import { Hash, Server as ServerIcon, User as UserIcon } from "lucide-react";
import * as irc from "../lib/irc";
import { strip as stripANSI } from "../lib/ansi";
import {
	BufferType,
	Unread,
	ServerStatus,
	getBufferURL,
	getServerName,
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
			if (user && irc.isMeaningfulRealname(user.realname, name)) {
				title = stripANSI(user.realname!);
			}
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

	let Icon = Hash;
	if (buffer.type === BufferType.SERVER) {
		Icon = ServerIcon;
	} else if (buffer.type === BufferType.NICK) {
		Icon = UserIcon;
	}

	return (
		<li className={classes.join(" ")}>
			<a
				href={getBufferURL(buffer, bouncerNetwork)}
				title={title}
				role="tab"
				aria-selected={active}
				aria-current={active ? "page" : undefined}
				aria-description={
					buffer.type === BufferType.SERVER
						? connectionLabel[connectionStatus(server, bouncerNetwork)]
						: undefined
				}
				onClick={handleClick}
				onMouseDown={handleMouseDown}
			>
				<Icon className="buffer-icon" aria-hidden="true" />
				<span className="buffer-name">{name}</span>
				{buffer.type === BufferType.SERVER && (
					<span
						className={`connection-status status-${connectionStatus(server, bouncerNetwork)}`}
						aria-hidden="true"
						title={connectionLabel[connectionStatus(server, bouncerNetwork)]}
					/>
				)}
				{buffer.unread !== Unread.NONE ? (
					<span
						className="unread-indicator"
						aria-label={buffer.unread === Unread.HIGHLIGHT ? "Mentions" : "Unread messages"}
					/>
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

export default function BufferList(props: BufferListProps) {
	const items = Array.from(props.buffers.values()).map((buf) => {
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
