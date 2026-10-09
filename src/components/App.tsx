import { useCallback, useEffect, useMemo, useRef, type MouseEvent } from "react";
import {
	ArrowRightLeft,
	CircleAlert,
	CircleHelp,
	ExternalLink,
	Moon,
	LogIn,
	MessageSquareText,
	MessagesSquare,
	Search,
	Server,
	Settings as SettingsIcon,
	ShieldCheck,
	UserPlus,
	Users,
	X,
} from "lucide-react";
import * as irc from "../lib/irc";
import {
	BufferType,
	ServerStatus,
	Unread,
	getServerName,
	unionUnread,
	type Buffer,
	type MemberAction,
} from "../state";
import { setup as setupKeybindings } from "../keybindings";
import { ControllerContext, useAppState, useController } from "../app/context";
import type AppController from "../app/controller";
import type { AppState } from "../app/store";
import BufferHeader from "./BufferHeader";
import BufferList from "./BufferList";
import ChatScroller from "./ChatScroller";
import Composer, { type ComposerHandle } from "./Composer";
import Dialog from "./Dialog";
import ErrorBoundary from "./ErrorBoundary";
import IconButton from "./IconButton";
import MemberList from "./MemberList";
import MessageList, { type MessageActionHandlers } from "./MessageList";
import SelfStatus from "./SelfStatus";
import TypingIndicator from "./TypingIndicator";
import type { Message } from "../lib/irc";
import AuthForm from "./forms/AuthForm";
import AwayForm from "./forms/AwayForm";
import ConfirmOpenBuffer from "./forms/ConfirmOpenBuffer";
import ConnectForm from "./forms/ConnectForm";
import Help from "./forms/Help";
import JoinForm from "./forms/JoinForm";
import NetworkForm from "./forms/NetworkForm";
import RegisterForm from "./forms/RegisterForm";
import SettingsForm from "./forms/SettingsForm";
import SwitcherForm from "./forms/SwitcherForm";
import SearchForm from "./forms/SearchForm";
import VerifyForm from "./forms/VerifyForm";

function ErrorToast({ error, onDismiss }: { error: string; onDismiss: () => void }) {
	return (
		<div id="error-msg" className="alert alert-danger toast" role="alert">
			<CircleAlert aria-hidden="true" />
			<div className="toast-text">{error}</div>
			<IconButton icon={X} label="Dismiss" onClick={onDismiss} />
		</div>
	);
}

/** A spinner next to a short status, e.g. while a dialog waits on the server */
function LoadingText({ children }: { children: string }) {
	return (
		<p className="loading-text" role="status">
			<span className="spinner" aria-hidden="true" /> {children}
		</p>
	);
}

function Dialogs({ state }: { state: AppState }) {
	const app = useController();
	const dialog = state.dialog;
	if (!dialog) {
		return null;
	}

	const dismiss = () => app.dismissDialog();
	const serverTitle = (serverID: number) => {
		const server = state.servers.get(serverID);
		return server ? getServerName(server, app.getBouncerNetwork(serverID)) : "server";
	};

	switch (dialog.kind) {
		case "network": {
			const isNew = !dialog.id;
			return (
				<Dialog
					title={isNew ? "Add network" : "Edit network"}
					icon={Server}
					description={
						isNew
							? "Connect the bouncer to another IRC network"
							: "Change how the bouncer connects to this network"
					}
					onDismiss={dismiss}
				>
					<NetworkForm
						isNew={isNew}
						params={dialog.params}
						autojoin={dialog.autojoin}
						onSubmit={(attrs, autojoin) => app.handleNetworkSubmit(dialog.id, attrs, autojoin)}
						onRemove={() => dialog.id && app.handleNetworkRemove(dialog.id)}
					/>
				</Dialog>
			);
		}
		case "help":
			return (
				<Dialog
					title="Help"
					icon={CircleHelp}
					description="Commands and keyboard shortcuts"
					onDismiss={dismiss}
					size="lg"
				>
					<Help />
				</Dialog>
			);
		case "join":
			return (
				<Dialog
					title="Join channel"
					icon={MessagesSquare}
					description={`On ${serverTitle(dialog.server)}`}
					onDismiss={dismiss}
					size="sm"
				>
					<JoinForm
						channel={dialog.channel}
						onSubmit={(channel) => {
							app.open(channel, dialog.server);
							app.dismissDialog();
						}}
					/>
				</Dialog>
			);
		case "confirm-open-buffer": {
			const client = app.getClient(dialog.server);
			const server = state.servers.get(dialog.server);
			const bouncerNetwork = app.getBouncerNetwork(dialog.server);
			return (
				<Dialog title="Open buffer" icon={ExternalLink} onDismiss={dismiss} size="sm">
					<ConfirmOpenBuffer
						name={dialog.name}
						isChannel={client?.isChannel(dialog.name) ?? false}
						networkName={server && bouncerNetwork ? getServerName(server, bouncerNetwork) : null}
						onSubmit={() => {
							app.open(dialog.name, dialog.server);
							app.dismissDialog();
						}}
					/>
				</Dialog>
			);
		}
		case "auth":
			return (
				<Dialog
					title="Log in"
					icon={LogIn}
					description={`With your ${serverTitle(dialog.server)} account`}
					onDismiss={dismiss}
					size="sm"
				>
					{dialog.loading ? (
						<LoadingText>Logging in…</LoadingText>
					) : (
						<AuthForm
							username={dialog.username}
							onSubmit={(username, password) =>
								app.handleAuthSubmit(dialog.server, username, password)
							}
						/>
					)}
				</Dialog>
			);
		case "register":
			return (
				<Dialog
					title="Create an account"
					icon={UserPlus}
					description={`On ${serverTitle(dialog.server)}`}
					onDismiss={dismiss}
					size="sm"
				>
					{dialog.loading ? (
						<LoadingText>Creating account…</LoadingText>
					) : (
						<RegisterForm
							emailRequired={dialog.emailRequired}
							onSubmit={(email, password) =>
								app.handleRegisterSubmit(dialog.server, email, password)
							}
						/>
					)}
				</Dialog>
			);
		case "verify":
			return (
				<Dialog
					title="Verify your account"
					icon={ShieldCheck}
					description={`On ${serverTitle(dialog.server)}`}
					onDismiss={dismiss}
					size="sm"
				>
					{dialog.loading ? (
						<LoadingText>Verifying account…</LoadingText>
					) : (
						<VerifyForm
							account={dialog.account}
							message={dialog.message}
							onSubmit={(code) => app.handleVerifySubmit(dialog.server, dialog.account, code)}
						/>
					)}
				</Dialog>
			);
		case "settings":
			return (
				<Dialog
					title="Settings"
					icon={SettingsIcon}
					description="Appearance, messages and notifications"
					onDismiss={dismiss}
					size="lg"
				>
					<SettingsForm
						settings={state.settings}
						showProtocolHandler={dialog.showProtocolHandler}
						pushAvailable={app.canEnablePush()}
						onPushChange={(enabled) => app.setPushNotifications(enabled)}
						onChange={(settings) => app.handleSettingsChange(settings)}
						onDisconnect={() => {
							app.dismissDialog();
							app.disconnectAll();
						}}
						onClose={dismiss}
					/>
				</Dialog>
			);
		case "search":
			return (
				<Dialog
					title={`Search ${serverTitle(dialog.server)}`}
					icon={Search}
					description="Find messages in the chat history"
					onDismiss={dismiss}
					size="lg"
				>
					<SearchForm
						buffer={dialog.buffer}
						initialQuery={dialog.query}
						onSearch={(query) => app.searchMessages(dialog.server, query)}
						onSelect={(result) => {
							app.dismissDialog();
							const { msgid, time } = result.message.tags;
							app.jumpToMessage(dialog.server, result.buffer, msgid!, time ?? undefined).catch(
								(err) => app.showError(err),
							);
						}}
					/>
				</Dialog>
			);
		case "away":
			return (
				<Dialog
					title="Set away"
					icon={Moon}
					description="Shown to others on all networks"
					onDismiss={dismiss}
					size="sm"
				>
					<AwayForm
						message={state.awayMessage}
						onSubmit={(message) => {
							app.setAway(message);
							app.dismissDialog();
						}}
					/>
				</Dialog>
			);
		case "switch":
			return (
				<Dialog
					title="Switch to a channel or user"
					icon={ArrowRightLeft}
					description="Type to filter, Enter to open"
					onDismiss={dismiss}
				>
					<SwitcherForm
						buffers={state.buffers}
						servers={state.servers}
						bouncerNetworks={state.bouncerNetworks}
						onSubmit={(buf) => {
							app.dismissDialog();
							if (buf) {
								app.switchBuffer(buf.id);
							}
						}}
					/>
				</Dialog>
			);
	}
}

function Chat({ state }: { state: AppState }) {
	const app = useController();
	const composer = useRef<ComposerHandle>(null);

	useEffect(() => app.registerComposer(() => composer.current?.focus()), [app]);

	const activeBuffer = state.activeBuffer !== null ? (state.buffers.get(state.activeBuffer) ?? null) : null;
	const activeServer = activeBuffer ? (state.servers.get(activeBuffer.server) ?? null) : null;
	const activeBouncerNetwork = activeServer?.bouncerNetID
		? (state.bouncerNetworks.get(activeServer.bouncerNetID) ?? null)
		: null;
	const activeClient = activeBuffer ? (app.getClient(activeBuffer.server) ?? null) : null;

	const handleChannelClick = useCallback(
		(event: MouseEvent<HTMLAnchorElement>) => {
			if (app.openURL(event.currentTarget.href)) {
				event.preventDefault();
			}
		},
		[app],
	);
	const handleNickClick = useCallback((nick: string) => app.open(nick), [app]);
	// Stable, so that the memoized member list doesn't re-render on every message
	const handleMemberClick = useCallback(
		(nick: string) => {
			app.open(nick);
			app.setOpenPanel("memberList", false);
		},
		[app],
	);
	const handleMemberAction = useCallback(
		(nick: string, action: MemberAction) => app.handleMemberAction(nick, action),
		[app],
	);
	const handleBufferClick = useCallback((buf: Buffer) => app.switchBuffer(buf.id), [app]);
	const handleBufferClose = useCallback((buf: Buffer) => app.close(buf.id), [app]);
	const handleScrollTop = useCallback(() => {
		app.fetchOlderMessages().catch((err) => app.showError(err));
	}, [app]);
	const handleComposerSubmit = useCallback((text: string) => app.handleComposerSubmit(text), [app]);
	const autocomplete = useCallback((prefix: string) => app.autocomplete(prefix), [app]);
	const handleTextChange = useCallback((text: string) => app.notifyTyping(text), [app]);
	const handleCancelReply = useCallback(() => app.cancelReply(), [app]);
	const handleJumped = useCallback(() => app.update({ jumpTo: null }), [app]);

	const activeID = activeBuffer?.id ?? null;
	const myNick = activeServer?.nick ?? null;
	let selfNick = myNick;
	for (const server of state.servers.values()) {
		selfNick ??= server.nick;
	}
	const canAct = activeServer?.status === ServerStatus.REGISTERED;
	const canReact = canAct && Boolean(activeServer?.features.reactions);
	const canReply = canAct && Boolean(activeServer?.features.replies);
	const canRedact = canAct && Boolean(activeServer?.features.redaction);
	// LogLine compares the flags rather than this object's identity
	const actions: MessageActionHandlers | undefined =
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
				};

	const handlers = useMemo(
		() => ({
			onChannelClick: handleChannelClick,
			onNickClick: handleNickClick,
			onVerifyClick: (account: string, message: string) => {
				const serverID = state.activeBuffer ? state.buffers.get(state.activeBuffer)?.server : null;
				if (serverID) {
					app.handleVerifyClick(serverID, account, message);
				}
			},
		}),
		[app, handleChannelClick, handleNickClick, state.activeBuffer, state.buffers],
	);

	let unreadElsewhere: Unread = Unread.NONE;
	for (const buf of state.buffers.values()) {
		if (buf.id !== activeBuffer?.id) {
			unreadElsewhere = unionUnread(unreadElsewhere, buf.unread);
		}
	}

	const composerReadOnly = !activeServer || activeServer.status !== ServerStatus.REGISTERED;
	let commandOnly = false;
	let privmsgMaxLen: number | undefined;
	if (activeBuffer?.type === BufferType.SERVER) {
		commandOnly = true;
	} else if (activeBuffer && activeClient?.nick) {
		privmsgMaxLen = irc.getMaxPrivmsgLen(activeClient.isupport, activeClient.nick, activeBuffer.name);
	}

	// Operators and half-operators
	const myMembership = myNick ? (activeBuffer?.members.get(myNick) ?? "") : "";
	const canModerate = canAct && /[~&@%]/.test(myMembership);

	let memberListClass = "";
	if (state.openPanels.memberList) {
		memberListClass = "expand";
	} else if (!state.settings.showMemberList) {
		memberListClass = "hidden";
	}

	return (
		<>
			<nav
				id="buffer-list"
				className={state.openPanels.bufferList ? "expand" : ""}
				aria-label="Buffers"
			>
				<div className="buffer-list-panel">
					<header className="sidebar-brand">
						<MessageSquareText aria-hidden="true" />
						<span>gamja</span>
						<IconButton
							icon={X}
							label="Close buffer list"
							className="panel-close"
							onClick={() => app.setOpenPanel("bufferList", false)}
						/>
					</header>
					<BufferList
						buffers={state.buffers}
						servers={state.servers}
						bouncerNetworks={state.bouncerNetworks}
						activeBuffer={state.activeBuffer}
						onBufferClick={handleBufferClick}
						onBufferClose={handleBufferClose}
					/>
					{selfNick && (
						<SelfStatus
							nick={selfNick}
							awayMessage={state.awayMessage}
							onSetAway={() => app.openDialog({ kind: "away" })}
							onBack={() => app.setAway(null)}
						/>
					)}
				</div>
			</nav>

			{activeBuffer && activeServer && (
				<header id="buffer-header">
					<BufferHeader
						buffer={activeBuffer}
						server={activeServer}
						user={
							activeBuffer.type === BufferType.NICK
								? (activeServer.users.get(activeBuffer.name) ?? null)
								: null
						}
						bouncerNetwork={activeBouncerNetwork}
						memberListHidden={!state.settings.showMemberList}
						unreadElsewhere={unreadElsewhere}
						onChannelClick={handleChannelClick}
						onClose={() => app.close(activeBuffer.id)}
						onDetach={
							activeServer.bouncerNetID
								? () => app.detachChannel(activeBuffer.id).catch((err) => app.showError(err))
								: undefined
						}
						onSetMetadata={
							activeServer.features.targetMetadata
								? (field, value) =>
										app.setTargetMetadata(
											activeBuffer.server,
											activeBuffer.name,
											field,
											value,
										)
								: undefined
						}
						onJoin={() => app.handleJoinClick(activeBuffer)}
						onReconnect={() => app.reconnect(activeBuffer.server)}
						onAddNetwork={() => app.openDialog({ kind: "network" })}
						onManageNetwork={() => app.handleManageNetworkClick(activeBuffer.server)}
						onOpenSettings={() => app.handleOpenSettingsClick()}
						onSearch={activeServer.features.search ? () => app.openSearch("buffer") : undefined}
						onOpenBufferList={() => app.setOpenPanel("bufferList", "toggle")}
						onOpenMemberList={() => app.setOpenPanel("memberList", "toggle")}
					/>
				</header>
			)}

			<ChatScroller
				id="buffer"
				scrollKey={state.activeBuffer}
				jumpTo={state.jumpTo?.buffer === state.activeBuffer ? state.jumpTo.msgid : null}
				onJumped={handleJumped}
				stickTo=".logline"
				onScrollTop={handleScrollTop}
				label={activeBuffer ? `Messages in ${activeBuffer.name}` : "Messages"}
			>
				<ErrorBoundary
					// Another buffer may display fine: start over when switching
					key={state.activeBuffer ?? "none"}
					fallback={(error, reset) => (
						<div className="alert alert-danger inline-error" role="alert">
							<CircleAlert aria-hidden="true" />
							<div>
								Failed to display messages: {error.message}{" "}
								<button type="button" className="btn btn-sm" onClick={reset}>
									Retry
								</button>
							</div>
						</div>
					)}
				>
					{activeBuffer && activeServer && (
						<MessageList
							buffer={activeBuffer}
							server={activeServer}
							bouncerNetwork={activeBouncerNetwork}
							settings={state.settings}
							actions={actions}
							onChannelClick={handlers.onChannelClick}
							onNickClick={handlers.onNickClick}
							onAuthClick={() => app.handleAuthClick(activeBuffer.server)}
							onRegisterClick={() => app.handleRegisterClick(activeBuffer.server)}
							onVerifyClick={handlers.onVerifyClick}
							onRetryHistory={() =>
								app.fetchOlderMessages(true).catch((err) => app.showError(err))
							}
						/>
					)}
				</ErrorBoundary>
			</ChatScroller>

			{activeBuffer?.type === BufferType.CHANNEL && activeServer && (
				<aside id="member-list" className={memberListClass} aria-label="Members list">
					<div className="member-list-panel">
						<header id="member-list-header">
							<Users aria-hidden="true" />
							<span>Members</span>
							<span className="badge" aria-label={`${activeBuffer.members.size} members`}>
								{activeBuffer.members.size}
							</span>
							<IconButton
								icon={X}
								label="Close member list"
								className="panel-close"
								onClick={() => app.setOpenPanel("memberList", false)}
							/>
						</header>
						<MemberList
							members={activeBuffer.members}
							users={activeServer.users}
							prefixes={activeServer.membershipModes?.map((m) => m.prefix).join("")}
							bouncerNetwork={activeBouncerNetwork}
							canModerate={canModerate}
							onNickClick={handleMemberClick}
							onAction={handleMemberAction}
						/>
					</div>
				</aside>
			)}

			<Composer
				ref={composer}
				status={<TypingIndicator buffer={activeBuffer} />}
				replyTo={state.replyTo?.buffer === activeBuffer?.id ? state.replyTo : null}
				onCancelReply={handleCancelReply}
				onTextChange={handleTextChange}
				readOnly={composerReadOnly}
				onSubmit={handleComposerSubmit}
				autocomplete={autocomplete}
				commandOnly={commandOnly}
				maxLen={privmsgMaxLen}
			/>
		</>
	);
}

function Root() {
	const app = useController();
	const state = useAppState((s) => s);

	useEffect(() => {
		const cleanupKeys = setupKeybindings(app);
		const cleanupWindow = app.attach();
		return () => {
			cleanupKeys();
			cleanupWindow();
		};
	}, [app]);

	if (state.loading) {
		return (
			<main id="connect">
				{state.error ? (
					<div className="alert alert-danger loading-error" role="alert">
						<CircleAlert aria-hidden="true" />
						<div>{state.error}</div>
					</div>
				) : (
					<div className="spinner spinner-lg" role="status" aria-label="Loading" />
				)}
			</main>
		);
	}

	if (state.connectForm) {
		const activeBuffer = state.activeBuffer !== null ? state.buffers.get(state.activeBuffer) : undefined;
		const status = activeBuffer
			? state.servers.get(activeBuffer.server)?.status
			: ServerStatus.DISCONNECTED;
		const connecting = status === ServerStatus.CONNECTING || status === ServerStatus.REGISTERING;
		return (
			<main id="connect">
				<ConnectForm
					error={state.error}
					params={state.connectParams}
					auth={app.config.server.auth}
					connecting={connecting}
					onSubmit={(params) => app.handleConnectSubmit(params)}
				/>
			</main>
		);
	}

	return (
		<>
			<Chat state={state} />
			<Dialogs state={state} />
			{state.error && <ErrorToast error={state.error} onDismiss={() => app.dismissError()} />}
		</>
	);
}

export default function App({ controller }: { controller: AppController }) {
	return (
		<ControllerContext.Provider value={controller}>
			<ErrorBoundary>
				<Root />
			</ErrorBoundary>
		</ControllerContext.Provider>
	);
}
