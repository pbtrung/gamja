import { memo, type KeyboardEvent } from "react";
import {
	BufferType,
	Unread,
	displayGroups,
	getServerKey,
	getServerName,
	type Buffer,
	type BouncerNetwork,
	type Server,
} from "../state";
import BufferItem from "./buffers/BufferItem";

interface BufferListProps {
	filter?: string;
	/** Only show the unread buffers, the active one and their networks */
	unreadOnly?: boolean;
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

function BufferList(props: BufferListProps) {
	const collapsed = props.collapsed ?? noneCollapsed;
	const query = props.filter?.trim().toLowerCase() ?? "";
	// Searching includes collapsed networks, without changing their saved state.
	const groups = displayGroups(
		props.buffers,
		props.servers,
		query ? noneCollapsed : collapsed,
		props.activeBuffer,
	)
		.map((group) => {
			const server = props.servers.get(group.server[0]?.server ?? group.shown[0]?.server);
			const network = server?.bouncerNetID ? props.bouncerNetworks.get(server.bouncerNetID) : null;
			const serverMatches =
				server &&
				getServerName(server, network ?? null)
					.toLowerCase()
					.includes(query);
			let shown = serverMatches
				? group.shown
				: group.shown.filter((buf) => buf.name.toLowerCase().includes(query));
			if (props.unreadOnly) {
				shown = shown.filter((buf) => buf.unread !== Unread.NONE || buf.id === props.activeBuffer);
			}
			const serverShown =
				!props.unreadOnly ||
				shown.length > 0 ||
				group.server.some((buf) => buf.unread !== Unread.NONE || buf.id === props.activeBuffer);
			return { ...group, shown, serverMatches, serverShown };
		})
		.filter((group) => group.serverShown && (!query || group.serverMatches || group.shown.length > 0));
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
			const isCollapsed = !query && isServer && collapsed.has(getServerKey(server));

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
			{shown.length === 0 && (
				<li className="filter-empty" role="presentation">
					{props.unreadOnly && !query ? "No unread buffer." : "No buffer matches the filter."}
				</li>
			)}
		</ul>
	);
}

// The chat re-renders on every state change: skip the ones not about buffers
export default memo(BufferList);
