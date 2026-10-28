import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { X } from "lucide-react";
import * as irc from "../lib/irc";
import { BufferType, ServerStatus, Unread, unionUnread, type Buffer, type MemberAction } from "../state";
import { setup as setupKeybindings } from "../keybindings";
import { ControllerContext, useAppState, useController } from "../app/context";
import type AppController from "../app/controller";
import type { AppState } from "../app/store";
import Alert from "./Alert";
import BufferHeader from "./BufferHeader";
import BufferList from "./BufferList";
import ChatMessages from "./ChatMessages";
import Composer, { type ComposerHandle } from "./Composer";
import Dialogs from "./Dialogs";
import ErrorBoundary from "./ErrorBoundary";
import IconButton from "./IconButton";
import FilterInput from "./FilterInput";
import MemberList from "./MemberList";
import SelfStatus from "./SelfStatus";
import TypingIndicator from "./TypingIndicator";
import useMediaQuery, { SMALL_SCREEN } from "./useMediaQuery";
import ConnectForm from "./forms/ConnectForm";

function ErrorToast({ error, onDismiss }: { error: string; onDismiss: () => void }) {
	return (
		<Alert className="toast" action={<IconButton icon={X} label="Dismiss" onClick={onDismiss} />}>
			{error}
		</Alert>
	);
}

function Chat({ state }: { state: AppState }) {
	const app = useController();
	const composer = useRef<ComposerHandle>(null);
	const smallScreen = useMediaQuery(SMALL_SCREEN);
	const [bufferFilter, setBufferFilter] = useState("");
	const closePanels = useCallback(() => {
		const toggle = app.state.openPanels.memberList ? ".member-list-toggle" : ".buffer-list-toggle";
		app.setOpenPanel("bufferList", false);
		app.setOpenPanel("memberList", false);
		document.querySelector<HTMLButtonElement>(toggle)?.focus();
	}, [app]);
	useEffect(() => {
		if (!smallScreen || (!state.openPanels.bufferList && !state.openPanels.memberList)) {
			return;
		}
		const onEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape" && !document.querySelector('[role="menu"], [aria-modal="true"]')) {
				closePanels();
			}
		};
		window.addEventListener("keydown", onEscape);
		return () => window.removeEventListener("keydown", onEscape);
	}, [smallScreen, state.openPanels.bufferList, state.openPanels.memberList, closePanels]);

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
	const handleToggleCollapse = useCallback(
		(buf: Buffer, all: boolean) => app.toggleCollapsed(buf.server, all),
		[app],
	);
	const handleComposerSubmit = useCallback((text: string) => app.handleComposerSubmit(text), [app]);
	const autocomplete = useCallback((prefix: string) => app.autocomplete(prefix), [app]);
	const handleTextChange = useCallback((text: string) => app.notifyTyping(text), [app]);
	const handleCancelReply = useCallback(() => app.cancelReply(), [app]);

	const activeID = activeBuffer?.id ?? null;
	const myNick = activeServer?.nick ?? null;
	let selfNick = myNick;
	for (const server of state.servers.values()) {
		selfNick ??= server.nick;
	}
	const canAct = activeServer?.status === ServerStatus.REGISTERED;

	let unreadElsewhere: Unread = Unread.NONE;
	for (const buf of state.buffers.values()) {
		if (buf.id !== activeBuffer?.id) {
			unreadElsewhere = unionUnread(unreadElsewhere, buf.unread);
		}
	}

	const composerReadOnly = !activeServer || activeServer.status !== ServerStatus.REGISTERED;
	let commandOnly = false;
	let privmsgMaxLen: number | undefined;
	let multiline: irc.MultilineLimits | null = null;
	if (activeBuffer?.type === BufferType.SERVER) {
		commandOnly = true;
	} else if (activeBuffer && activeClient?.nick) {
		privmsgMaxLen = irc.getMaxPrivmsgLen(activeClient.isupport, activeClient.nick, activeBuffer.name);
		multiline = activeClient.multilineLimits();
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
				className={state.openPanels.bufferList ? "expand" : state.bufferListHidden ? "hidden" : ""}
				aria-label="Buffers"
			>
				<div className="buffer-list-panel">
					<header className="sidebar-filter">
						<FilterInput
							value={bufferFilter}
							onChange={setBufferFilter}
							label="Filter buffers"
							placeholder="Filter buffers"
						/>
					</header>
					<BufferList
						filter={bufferFilter}
						buffers={state.buffers}
						servers={state.servers}
						bouncerNetworks={state.bouncerNetworks}
						activeBuffer={state.activeBuffer}
						collapsed={state.collapsedNetworks}
						onBufferClick={handleBufferClick}
						onBufferClose={handleBufferClose}
						onToggleCollapse={handleToggleCollapse}
					/>
					<div className="sidebar-footer">
						{selfNick && (
							<SelfStatus
								nick={selfNick}
								awayMessage={state.awayMessage}
								onSetAway={() => app.openDialog({ kind: "away" })}
								onBack={() => app.setAway(null)}
							/>
						)}
						{import.meta.env.GAMJA_VERSION && (
							<span className="sidebar-version" title="gamja version">
								{import.meta.env.GAMJA_VERSION}
							</span>
						)}
					</div>
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
						bufferListOpen={smallScreen ? state.openPanels.bufferList : !state.bufferListHidden}
						bufferListHidden={state.bufferListHidden}
						memberListOpen={
							smallScreen
								? state.openPanels.memberList
								: state.settings.showMemberList || state.openPanels.memberList
						}
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
						onOpenBufferList={() => {
							if (smallScreen) {
								app.setOpenPanel("memberList", false);
								app.setOpenPanel("bufferList", "toggle");
							} else {
								app.setBufferListHidden(!state.bufferListHidden);
							}
						}}
						onOpenMemberList={() => {
							if (smallScreen) {
								app.setOpenPanel("bufferList", false);
								app.setOpenPanel("memberList", "toggle");
							} else {
								app.setOpenPanel("memberList", false);
								app.handleSettingsChange({
									showMemberList: !(
										state.settings.showMemberList || state.openPanels.memberList
									),
								});
							}
						}}
					/>
				</header>
			)}

			<ChatMessages onChannelClick={handleChannelClick} />

			{activeBuffer?.type === BufferType.CHANNEL && activeServer && (
				<aside id="member-list" className={memberListClass} aria-label="Members list">
					<div className="member-list-panel">
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

			{smallScreen && (state.openPanels.bufferList || state.openPanels.memberList) && (
				<button
					type="button"
					className="panel-backdrop"
					aria-label="Close side panels"
					onClick={closePanels}
				/>
			)}

			<Composer
				ref={composer}
				edgeToEdgeInput={state.settings.edgeToEdgeInput}
				draftKey={activeID}
				status={state.settings.showTyping ? <TypingIndicator buffer={activeBuffer} /> : null}
				replyTo={state.replyTo?.buffer === activeBuffer?.id ? state.replyTo : null}
				onCancelReply={handleCancelReply}
				onTextChange={handleTextChange}
				readOnly={composerReadOnly}
				onSubmit={handleComposerSubmit}
				autocomplete={autocomplete}
				commandOnly={commandOnly}
				maxLen={privmsgMaxLen}
				multiline={multiline}
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
					<Alert className="loading-error">{state.error}</Alert>
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
			{/* A new dialog, not an update of the previous one: it takes the focus */}
			<Dialogs key={state.dialog?.kind} state={state} />
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
