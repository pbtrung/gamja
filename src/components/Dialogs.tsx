import {
	ArrowRightLeft,
	CircleHelp,
	ExternalLink,
	Moon,
	LogIn,
	MessagesSquare,
	Search,
	Server,
	ShieldCheck,
	UserPlus,
} from "lucide-react";
import { BufferType, ServerStatus, getServerName } from "../state";
import { useController } from "../app/context";
import type { AppState } from "../app/store";
import Dialog from "./Dialog";
import AuthForm from "./forms/AuthForm";
import AwayForm from "./forms/AwayForm";
import ConfirmOpenBuffer from "./forms/ConfirmOpenBuffer";
import Help from "./forms/Help";
import JoinForm from "./forms/JoinForm";
import NetworkForm from "./forms/NetworkForm";
import RegisterForm from "./forms/RegisterForm";
import SettingsForm, { SettingsDialog } from "./forms/SettingsForm";
import SwitcherForm from "./forms/SwitcherForm";
import SearchForm from "./forms/SearchForm";
import VerifyForm from "./forms/VerifyForm";

/** A spinner next to a short status, e.g. while a dialog waits on the server */
function LoadingText({ children }: { children: string }) {
	return (
		<p className="loading-text" role="status">
			<span className="spinner" aria-hidden="true" /> {children}
		</p>
	);
}

/** The open dialog, if any */
export default function Dialogs({ state }: { state: AppState }) {
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
						onRemove={async () => {
							if (dialog.id) {
								await app.handleNetworkRemove(dialog.id);
							}
						}}
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
				<SettingsDialog onDismiss={dismiss}>
					{(tab, setTab) => (
						<SettingsForm
							tab={tab}
							onTabChange={setTab}
							settings={state.settings}
							bouncers={Array.from(state.buffers.values()).flatMap((buffer) => {
								const server = state.servers.get(buffer.server);
								if (
									buffer.type !== BufferType.SERVER ||
									!server?.isBouncer ||
									server.status !== ServerStatus.REGISTERED
								) {
									return [];
								}
								return [
									{
										name: getServerName(server, app.getBouncerNetwork(server.id)),
										version: buffer.serverInfo?.version ?? null,
									},
								];
							})}
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
					)}
				</SettingsDialog>
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
					description={
						// soju keeps the message to itself, and only tells the
						// networks once all of our clients are away
						[...state.servers.values()].some((s) => s.isBouncer || s.bouncerNetID)
							? "With soju, others see you away once all your clients are, without this message"
							: "Shown to others on all networks"
					}
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
