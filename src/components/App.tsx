import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { X } from "lucide-react";
import { BufferType, ServerStatus } from "../state";
import { setup as setupKeybindings } from "../keybindings";
import { ControllerContext, useAppState, useController } from "../app/context";
import type AppController from "../app/controller";
import type { AppState } from "../app/store";
import Alert from "./Alert";
import BufferHeader from "./BufferHeader";
import ChatMessages from "./ChatMessages";
import Composer, { type ComposerHandle } from "./Composer";
import Dialogs from "./Dialogs";
import ErrorBoundary from "./ErrorBoundary";
import IconButton from "./IconButton";
import TypingIndicator from "./TypingIndicator";
import useMediaQuery, { SMALL_SCREEN } from "./useMediaQuery";
import BufferSidebar from "./app/BufferSidebar";
import MemberSidebar from "./app/MemberSidebar";
import { getComposerLimits, getUnreadElsewhere } from "./app/chatState";
import useSidePanels from "./app/useSidePanels";
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
	const closePanels = useSidePanels(app, smallScreen, state.openPanels);

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
	const handleComposerSubmit = useCallback((text: string) => app.handleComposerSubmit(text), [app]);
	const autocomplete = useCallback((prefix: string) => app.autocomplete(prefix), [app]);
	const handleTextChange = useCallback((text: string) => app.notifyTyping(text), [app]);
	const handleCancelReply = useCallback(() => app.cancelReply(), [app]);

	const activeID = activeBuffer?.id ?? null;
	const myNick = activeServer?.nick ?? null;
	const canAct = activeServer?.status === ServerStatus.REGISTERED;
	const unreadElsewhere = getUnreadElsewhere(state, activeBuffer);

	const composerReadOnly = !activeServer || activeServer.status !== ServerStatus.REGISTERED;
	const { commandOnly, maxLen: privmsgMaxLen, multiline } = getComposerLimits(activeBuffer, activeClient);

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
			<BufferSidebar state={state} smallScreen={smallScreen} />

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
						onOpenBufferList={() => app.toggleBufferList(smallScreen)}
						onOpenMemberList={() => app.toggleMemberList(smallScreen)}
					/>
				</header>
			)}

			<ChatMessages onChannelClick={handleChannelClick} />

			{activeBuffer?.type === BufferType.CHANNEL && activeServer && (
				<MemberSidebar
					buffer={activeBuffer}
					server={activeServer}
					bouncerNetwork={activeBouncerNetwork}
					className={memberListClass}
					smallScreen={smallScreen}
					canModerate={canModerate}
				/>
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
