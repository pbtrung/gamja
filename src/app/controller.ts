import type * as irc from "../lib/irc";
import type Client from "../lib/client";
import { ClientStatus } from "../lib/client";
import * as S from "../state";
import type { Buffer, BufferID, Updater, Server } from "../state";
import * as store from "../store";
import * as webpush from "./webpush";
import { applyTheme } from "../themes";
import { applyFonts } from "../fonts";
import { createAppStore, type AppState, type AppStore } from "./store";
import { fetchConfig, type Config } from "./config";
import type { MessageNotification } from "./notifications";
import { connectionMethods, type ConnectionMethods } from "./connection";
import { incomingMethods, type IncomingMethods } from "./incoming";
import { startupMethods, type StartupMethods } from "./startup";
import { buffersMethods, type BuffersMethods } from "./buffers";
import { readMethods, type ReadMethods } from "./read";
import { navigationMethods, type NavigationMethods } from "./navigation";
import { panelsMethods, type PanelsMethods } from "./panels";
import { notificationsMethods, type NotificationsMethods } from "./notifications";
import { routingMethods, type RoutingMethods } from "./routing";
import { historyMethods, type HistoryMethods } from "./history";
import { backlogMethods, type BacklogMethods, type DeferredBacklog } from "./backlog";
import { searchMethods, type SearchMethods } from "./search";
import { networkMethods, type NetworkMethods } from "./network";
import { registrationMethods, type RegistrationMethods } from "./registration";
import { pushMethods, type PushMethods } from "./push";
import { messagingMethods, type MessagingMethods } from "./messaging";
import { dialogsMethods, type DialogsMethods } from "./dialogs";
import { windowMethods, type WindowMethods } from "./window";

let lastErrorID = 0;

/**
 * Owns the IRC connections and drives the application state. React
 * components read the state from `store` and call methods on the controller.
 */
// Merged with the interface at the end of the file
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export default class AppController {
	store: AppStore;
	config: Config = { server: {} };
	clients = new Map<number, Client>();
	bufferStore = new store.BufferStore();
	debug = !import.meta.env.PROD;
	/** Channel to switch to once joined, on any server if server is null */
	switchToChannel: { server: number | null; name: string } | null = null;
	/**
	 * Parsed irc:// URL to automatically open. The user will be prompted for
	 * confirmation for security reasons.
	 */
	autoOpenURL: irc.IRCURL | null = null;
	/** Initial focused buffer from window hash. */
	initialRoute: { host?: string; entity: string } | null = null;
	messageNotifications = new Set<MessageNotification>();
	baseTitle = "gamja";
	lastFocusPingDate: Date | null = null;
	/** Missed channel messages to fetch once their buffer is opened, by
	 * buffer ID, see deferBacklog() */
	deferredBacklogs = new Map<number, DeferredBacklog>();
	/** The buffer active before the current one, see keybindings.ts */
	previousBuffer: number | null = null;
	/** Whether the latest messages of the active buffer are in view */
	scrolledToLatest = true;
	/** Browser APIs for Web Push, null if unsupported */
	pushEnv: webpush.PushEnvironment | null = webpush.getPushEnvironment();
	/** Hooks provided by the UI */
	ui: { focusComposer?: () => void } = {};
	/** Whether the user is at the page, see Client.present */
	present = typeof document === "undefined" || document.visibilityState !== "hidden";
	awayTimeoutID: ReturnType<typeof setTimeout> | undefined;
	typingState: { buffer: number | null; lastSent: number; status: string } = {
		buffer: null,
		lastSent: 0,
		status: "done",
	};

	constructor(appStore: AppStore = createAppStore()) {
		this.store = appStore;

		const settings = store.settings.load();
		if (settings) {
			this.update((state) => ({ settings: { ...state.settings, ...settings } }));
		}
		applyTheme(this.state.settings.theme);
		applyFonts(this.state.settings);
		this.update({
			collapsedNetworks: new Set(store.collapsedNetworks.load() ?? []),
			bufferListHidden: store.bufferListHidden.load() ?? false,
			bufferListUnreadOnly: store.bufferListUnreadOnly.load() ?? false,
		});
		if (this.state.settings.autoAwayMinutes <= 0) {
			this.present = true;
		}
	}

	/** Called by the UI to let the controller focus the composer. Returns a cleanup function. */
	registerComposer(focus: () => void): () => void {
		this.ui.focusComposer = focus;
		return () => {
			if (this.ui.focusComposer === focus) {
				this.ui.focusComposer = undefined;
			}
		};
	}

	get state(): AppState {
		return this.store.getState();
	}

	/** Apply a state update. Returns nothing, the store is updated synchronously. */
	update(
		updater:
			| Partial<AppState>
			| null
			| undefined
			| ((state: AppState) => Partial<AppState> | null | undefined | void),
	): void {
		const state = this.store.getState();
		const patch = typeof updater === "function" ? updater(state) : updater;
		if (patch) {
			this.store.setState(patch);
		}
	}

	async start(config?: Config): Promise<void> {
		this.baseTitle = document.title || "gamja";
		await this.handleConfig(config ?? (await fetchConfig()));
	}

	showError(err: unknown): number {
		console.error("App error: ", err);

		let text;
		if (err instanceof Error) {
			const l: string[] = [];
			let e: unknown = err;
			while (e instanceof Error) {
				l.push(e.message);
				e = e.cause;
			}
			text = l.join(": ");
		} else {
			text = String(err);
		}
		this.update({ error: text });
		lastErrorID++;
		return lastErrorID;
	}

	dismissError(id?: number | null): void {
		if (id && id !== lastErrorID) {
			return;
		}
		this.update({ error: null });
	}

	setServerState(id: number, updater: Updater<Server>): void {
		this.update((state) => S.updateServer(state, id, updater));
	}

	setBufferState(id: BufferID, updater: Updater<Buffer>): void {
		this.update((state) => S.updateBuffer(state, id, updater));
	}

	getClient(serverID: number | null | undefined): Client | undefined {
		if (serverID === null || serverID === undefined) {
			return undefined;
		}
		return this.clients.get(serverID);
	}

	/**
	 * Get the client of a server if it's ready to send messages, otherwise
	 * show an error: sending on a closed connection throws.
	 */
	getConnectedClient(serverID: number | null | undefined): Client | undefined {
		const client = this.getClient(serverID);
		if (!client || client.status !== ClientStatus.REGISTERED) {
			this.showError("Not connected to the server");
			return undefined;
		}
		return client;
	}

	getActiveClient(): Client | undefined {
		return this.getClient(S.getActiveServerID(this.state));
	}

	getBouncerNetwork(serverID: number): S.BouncerNetwork | null {
		const server = this.state.servers.get(serverID);
		if (!server?.bouncerNetID) {
			return null;
		}
		return this.state.bouncerNetworks.get(server.bouncerNetID) ?? null;
	}

	destroy(): void {
		for (const client of this.clients.values()) {
			client.disconnect();
		}
		this.clients.clear();
		this.bufferStore.dispose();
	}
}

// The controller's methods are grouped by topic in the modules imported
// above, as objects of methods taking the controller as this: merge their
// types into the class, and their methods into its prototype. Merging is
// safe as long as every module listed here is also assigned below.
export default interface AppController // eslint-disable-line @typescript-eslint/no-unsafe-declaration-merging
	extends
		StartupMethods,
		ConnectionMethods,
		IncomingMethods,
		BuffersMethods,
		ReadMethods,
		NavigationMethods,
		PanelsMethods,
		NotificationsMethods,
		RoutingMethods,
		HistoryMethods,
		BacklogMethods,
		SearchMethods,
		NetworkMethods,
		RegistrationMethods,
		PushMethods,
		MessagingMethods,
		DialogsMethods,
		WindowMethods {}
Object.assign(
	AppController.prototype,
	startupMethods,
	connectionMethods,
	incomingMethods,
	buffersMethods,
	readMethods,
	navigationMethods,
	panelsMethods,
	notificationsMethods,
	routingMethods,
	historyMethods,
	backlogMethods,
	searchMethods,
	networkMethods,
	registrationMethods,
	pushMethods,
	messagingMethods,
	dialogsMethods,
	windowMethods,
);
