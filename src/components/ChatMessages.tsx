import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { BufferType, ServerStatus, unreadSince } from "../state";
import { formatTime } from "../format";
import { useAppState, useController } from "../app/context";
import type AppController from "../app/controller";
import type { Message } from "../lib/irc";
import Alert from "./Alert";
import ChatScroller from "./ChatScroller";
import ErrorBoundary from "./ErrorBoundary";
import MessageList, { type MessageActionHandlers } from "./MessageList";
import type { LinkClickHandler } from "./RichText";

/** How long the "New messages" separator stays in the visible active buffer */
const UNREAD_SEPARATOR_DELAY = 8000;

/**
 * The messages of the active buffer. Only subscribes to the state they
 * show: the scroller restores its position when they re-render.
 */
const ChatMessages = memo(function ChatMessages({ onChannelClick }: { onChannelClick: LinkClickHandler }) {
	const app = useController();
	const buffer = useAppState((s) =>
		s.activeBuffer !== null ? (s.buffers.get(s.activeBuffer) ?? null) : null,
	);
	const server = useAppState((s) => (buffer ? (s.servers.get(buffer.server) ?? null) : null));
	const bouncerNetwork = useAppState((s) =>
		server?.bouncerNetID ? (s.bouncerNetworks.get(server.bouncerNetID) ?? null) : null,
	);
	const settings = useAppState((s) => s.settings);
	const jumpTo = useAppState((s) => (s.jumpTo?.buffer === s.activeBuffer ? s.jumpTo.msgid : null));

	const activeID = buffer?.id ?? null;

	// The separator and its jump button go away after a while in the
	// visible buffer, wherever it's scrolled. New messages don't bring it
	// back: it only shows again for another read receipt or buffer.
	const unread = useMemo(
		() =>
			buffer && buffer.type !== BufferType.SERVER
				? unreadSince(buffer.messages, buffer.prevReadReceipt)
				: null,
		[buffer],
	);
	const markerKey = `${activeID}:${buffer?.prevReadReceipt?.time ?? ""}`;
	const [seenMarker, setSeenMarker] = useState<string | null>(null);
	const hasUnread = unread !== null;
	useEffect(() => {
		if (!hasUnread) {
			return;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		const restart = () => {
			clearTimeout(timer);
			if (document.visibilityState !== "hidden") {
				timer = setTimeout(() => setSeenMarker(markerKey), UNREAD_SEPARATOR_DELAY);
			}
		};
		restart();
		document.addEventListener("visibilitychange", restart);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", restart);
		};
	}, [hasUnread, markerKey]);
	const unreadLabel = unread
		? `${unread.count} new ${unread.count === 1 ? "message" : "messages"} since ${formatTime(unread.first, false, settings.clock12h)}`
		: undefined;

	const myNick = server?.nick ?? null;
	const canAct = server?.status === ServerStatus.REGISTERED;
	const canReact = canAct && Boolean(server?.features.reactions);
	const canReply = canAct && Boolean(server?.features.replies);
	const canRedact = canAct && Boolean(server?.features.redaction);
	// Stable, so that the memoized message list doesn't re-render for nothing
	const actions = useMemo<MessageActionHandlers | undefined>(
		() =>
			activeID === null || (!canReact && !canReply && !canRedact)
				? undefined
				: {
						myNick,
						canReact,
						canReply,
						canRedact,
						onReact: (msg: Message, emoji: string) => app.react(activeID, msg, emoji),
						onReply: (msg: Message) => app.startReply(activeID, msg),
						onRedact: (msg: Message) => app.redact(activeID, msg),
					},
		[app, activeID, myNick, canReact, canReply, canRedact],
	);

	const handleNickClick = useCallback((nick: string) => app.open(nick), [app]);
	const handleScrollTop = useCallback(() => {
		app.fetchOlderMessages().catch((err) => app.showError(err));
	}, [app]);
	const handleJumped = useCallback(() => app.update({ jumpTo: null }), [app]);
	const handleBottomChange = useCallback(
		(atBottom: boolean) => app.handleScrolledToLatest(atBottom),
		[app],
	);
	const handleRetryHistory = useCallback(() => {
		app.fetchOlderMessages(true).catch((err) => app.showError(err));
	}, [app]);
	const handleLoadGap = useCallback(() => {
		const id = app.state.activeBuffer;
		if (id !== null) {
			app.fetchMissedMessages(id).catch((err) => app.showError(err));
		}
	}, [app]);
	// The server is read when called, so that these stay the same
	const handleAuthClick = useCallback(() => {
		const serverID = activeServerID(app);
		if (serverID !== undefined) {
			app.handleAuthClick(serverID);
		}
	}, [app]);
	const handleRegisterClick = useCallback(() => {
		const serverID = activeServerID(app);
		if (serverID !== undefined) {
			app.handleRegisterClick(serverID);
		}
	}, [app]);
	const handleVerifyClick = useCallback(
		(account: string, message: string) => {
			const serverID = activeServerID(app);
			if (serverID !== undefined) {
				app.handleVerifyClick(serverID, account, message);
			}
		},
		[app],
	);

	return (
		<ChatScroller
			id="buffer"
			scrollKey={activeID}
			jumpTo={jumpTo}
			onJumped={handleJumped}
			stickTo=".logline"
			unreadMarker=".unread-separator"
			unreadLabel={unreadLabel}
			onScrollTop={handleScrollTop}
			onBottomChange={handleBottomChange}
			label={buffer ? `Messages in ${buffer.name}` : "Messages"}
		>
			<ErrorBoundary
				// Another buffer may display fine: start over when switching
				key={activeID ?? "none"}
				fallback={(error, reset) => (
					<Alert className="inline-error">
						Failed to display messages: {error.message}{" "}
						<button type="button" className="btn btn-sm" onClick={reset}>
							Retry
						</button>
					</Alert>
				)}
			>
				{buffer && server && (
					<MessageList
						buffer={buffer}
						server={server}
						bouncerNetwork={bouncerNetwork}
						settings={settings}
						hideUnreadSeparator={seenMarker === markerKey}
						actions={actions}
						onChannelClick={onChannelClick}
						onNickClick={handleNickClick}
						onAuthClick={handleAuthClick}
						onRegisterClick={handleRegisterClick}
						onVerifyClick={handleVerifyClick}
						onRetryHistory={handleRetryHistory}
						onLoadGap={handleLoadGap}
					/>
				)}
			</ErrorBoundary>
		</ChatScroller>
	);
});

/** The server of the active buffer */
function activeServerID(app: AppController): number | undefined {
	const id = app.state.activeBuffer;
	return id !== null ? app.state.buffers.get(id)?.server : undefined;
}

export default ChatMessages;
