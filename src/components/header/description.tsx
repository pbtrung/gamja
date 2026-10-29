import type { ReactNode } from "react";
import { strip as stripANSI } from "../../lib/ansi";
import { meaningfulRealname } from "../../format";
import {
	BufferType,
	ServerStatus,
	type Buffer,
	type BouncerNetwork,
	type Server,
	type User,
} from "../../state";
import RichText, { type LinkClickHandler } from "../RichText";
import Countdown from "./Countdown";
import UserDescription from "./UserDescription";

export interface Description {
	content: ReactNode;
	/** Tooltip, the plain text of the content */
	title?: string;
}

function formatLag(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function describeBouncerNetwork(bouncerNetwork: BouncerNetwork): string | null {
	switch (bouncerNetwork.state) {
		case "disconnected": {
			let description = "Bouncer disconnected from network";
			if (bouncerNetwork.error) {
				description += ": " + bouncerNetwork.error;
			}
			return description;
		}
		case "connecting":
			return "Bouncer connecting to network…";
		case "connected":
			// host can be undefined e.g. when using UNIX domain sockets
			return `Connected to ${bouncerNetwork.host || "network"}`;
	}
	return null;
}

/** The connection status of a server buffer */
function describeServer(buffer: Buffer, server: Server, bouncerNetwork: BouncerNetwork | null): ReactNode {
	switch (server.status) {
		case ServerStatus.DISCONNECTED:
			return server.reconnectAt ? (
				<>
					Disconnected, reconnecting in <Countdown to={server.reconnectAt} />
				</>
			) : (
				"Disconnected"
			);
		case ServerStatus.CONNECTING:
			return "Connecting…";
		case ServerStatus.REGISTERING:
			return "Logging in…";
		case ServerStatus.REGISTERED: {
			let description: string | null;
			if (bouncerNetwork) {
				description = describeBouncerNetwork(bouncerNetwork);
			} else if (buffer.serverInfo) {
				description = `Connected to ${buffer.serverInfo.name}`;
			} else {
				description = "Connected";
			}
			if (typeof description === "string" && typeof server.lag === "number") {
				description += ` · ${formatLag(server.lag)} lag`;
			}
			return description;
		}
	}
	return null;
}

/** The header description of a buffer: connection status, topic or user info */
export function describeBuffer(
	buffer: Buffer,
	server: Server,
	user: User | null,
	bouncerNetwork: BouncerNetwork | null,
	onChannelClick: LinkClickHandler,
): Description {
	let content: ReactNode = null;
	let title: string | undefined;
	switch (buffer.type) {
		case BufferType.SERVER:
			content = describeServer(buffer, server, bouncerNetwork);
			break;
		case BufferType.CHANNEL:
			if (buffer.topic) {
				title = stripANSI(buffer.topic);
				content = <RichText text={buffer.topic} onLinkClick={onChannelClick} />;
			}
			break;
		case BufferType.NICK:
			if (user) {
				title = meaningfulRealname(user, buffer.name) ?? buffer.name;
				content = <UserDescription user={user} buffer={buffer} server={server} />;
			}
			break;
	}
	if (typeof content === "string") {
		title = content;
	}
	return { content, title };
}
