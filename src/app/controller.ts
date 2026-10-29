import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import Client, { ClientStatus, IRCError, type MessageEventDetail, type Multiplexer } from "../lib/client";
import * as S from "../state";
import {
	SERVER_BUFFER,
	ReceiptType,
	Unread,
	BufferEventsDisplayMode,
	type Buffer,
	type BufferID,
	type Updater,
	type Server,
} from "../state";
import * as store from "../store";
import * as webpush from "./webpush";
import { applyTheme } from "../themes";
import { applyFonts } from "../fonts";
import { createAppStore, type AppState, type AppStore, type ConnectParams } from "./store";
import { fetchConfig, resolveServerURL, splitHostPort, type Config } from "./config";
import { getReceipt, storeServer, type HistoryBatch } from "./history";
import type { MessageNotification } from "./notifications";
import { startupMethods, type StartupMethods } from "./startup";
import { buffersMethods, type BuffersMethods } from "./buffers";
import { notificationsMethods, type NotificationsMethods } from "./notifications";
import { routingMethods, type RoutingMethods } from "./routing";
import { historyMethods, type HistoryMethods } from "./history";
import { networkMethods, type NetworkMethods } from "./network";
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

	/**
	 * Handle configuration data and populate the connection parameters.
	 *
	 * The priority order is:
	 *
	 * - URL params
	 * - Saved parameters in local storage
	 * - Configuration data (fetched from the config.json file)
	 * - Default server URL constructed from the current URL location
	 */

	/**
	 * Get an OAuth 2.0 token, from the authorization code in the URL or by
	 * redirecting to the authorization server. Returns false if the token
	 * isn't available (yet).
	 */

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

	/**
	 * Store the receipts of a buffer, and send its read marker if it moved.
	 * With a batch, only the last read marker of each buffer is sent, once the
	 * whole batch is handled.
	 */

	prepareChatMessage(serverID: number, msg: Message): void {
		// Treat server-wide broadcasts as highlights. They're sent by server
		// operators and can contain important information.
		if (msg.isHighlight === undefined) {
			const client = this.clients.get(serverID);
			msg.isHighlight =
				!!client?.nick &&
				(irc.isHighlight(msg, client.nick, client.cm) || irc.isServerBroadcast(msg));
		}

		if (!msg.tags) {
			// Can happen for outgoing messages for instance
			msg.tags = {};
		}
		if (!msg.tags.time) {
			msg.tags.time = irc.formatDate(new Date());
		}
	}

	/**
	 * Unread state brought by a PRIVMSG or NOTICE not read yet: nothing for
	 * our own messages and blocked users (soju's metadata), a highlight for
	 * mentions and private messages, unless the buffer is muted.
	 */

	/**
	 * Show a message in a buffer, as new: it may mark the buffer unread and
	 * notify. With a batch, the message is only added once the whole batch is
	 * handled, see applyHistory().
	 */
	handleChatMessage(serverID: number, bufName: string, msg: Message, batch?: HistoryBatch): void {
		const client = this.clients.get(serverID)!;

		this.prepareChatMessage(serverID, msg);

		const from = msg.prefix?.name ?? "*";
		const server = this.state.servers.get(serverID);
		if (
			S.getTargetMetadata(server, from).blocked &&
			!S.getBuffer(this.state, { server: serverID, name: bufName })
		) {
			return; // Don't open a conversation for a blocked user
		}

		const stored = this.bufferStore.get({ name: bufName, server: storeServer(client) });
		let msgUnread: Unread = Unread.NONE;
		if (
			(msg.command === "PRIVMSG" || msg.command === "NOTICE") &&
			!S.isMessageBeforeReceipt(msg, getReceipt(stored, ReceiptType.READ))
		) {
			msgUnread = this.chatMessageUnread(client, server, bufName, msg);
			if (!S.isMessageBeforeReceipt(msg, getReceipt(stored, ReceiptType.DELIVERED))) {
				this.notifyChatMessage(serverID, bufName, msg, msgUnread);
			}
		}
		if (msg.command === "INVITE" && client.isMyNick(msg.params[0])) {
			msgUnread = Unread.HIGHLIGHT;
			this.notifyInvite(serverID, bufName, msg);
		}

		if (
			msg.command !== "PART" &&
			msg.command !== "QUIT" &&
			msg.command !== irc.RPL_MONONLINE &&
			msg.command !== irc.RPL_MONOFFLINE
		) {
			this.createBuffer(serverID, bufName);
		}

		const bufID = { server: serverID, name: bufName };
		if (batch) {
			this.queueHistoryMessage(batch, bufID, msg);
		} else {
			this.update((state) => S.addMessage(state, msg, bufID));
			this.trimBuffer(bufID);
		}
		if (msg.command === "PRIVMSG" || msg.command === "NOTICE") {
			this.setBufferState(bufID, (b) =>
				b.typing.size > 0 ? S.applyTyping(b, from, "done", client.cm) : undefined,
			);
		}

		const buf = S.getBuffer(this.state, bufID);
		if (!buf) {
			return;
		}

		let unread = buf.unread;
		let prevReadReceipt = buf.prevReadReceipt;
		const receipts: store.Receipts = { [ReceiptType.DELIVERED]: S.receiptFromMessage(msg) };

		// Scrolled up, the user is reading older messages, not this one
		if (!this.isBufferVisible(buf.id) || !this.scrolledToLatest) {
			unread = S.unionUnread(unread, msgUnread);
		} else if (!buf.gap) {
			// With missed messages not fetched yet, the user hasn't read them
			receipts[ReceiptType.READ] = S.receiptFromMessage(msg);
		}

		// Don't show unread marker for my own messages
		if (client.isMyNick(from) && !S.isMessageBeforeReceipt(msg, prevReadReceipt)) {
			prevReadReceipt = S.receiptFromMessage(msg);
		}

		this.storeReceipts(client, { name: buf.name, server: storeServer(client), unread, receipts }, batch);
		if (unread !== buf.unread || prevReadReceipt !== buf.prevReadReceipt) {
			this.setBufferState(buf.id, { unread, prevReadReceipt });
		}

		if (msgUnread === Unread.HIGHLIGHT) {
			this.updateDocumentTitle();
		}
	}

	/**
	 * Show a page of chat history, with one state update per buffer. Live
	 * history, missed while disconnected, is handled like new messages: it
	 * marks buffers unread and notifies.
	 */

	/**
	 * Connect to a server, or to a bouncer network. A bouncer network is
	 * attached to the bouncer connection of the multiplexer if given, rather
	 * than getting its own connection (soju.im/multiplex).
	 */
	connect(params: Partial<ConnectParams>, multiplexer: Multiplexer | null = null): number {
		// Merge our previous connection params so that config options such as
		// the ping interval are applied
		const merged: ConnectParams = {
			...this.state.connectParams,
			...params,
		};

		let serverID = 0;
		this.update((state) => {
			let update;
			[serverID, update] = S.createServer(state);
			return update;
		});
		// Per-network connections reuse these params, they mustn't become the
		// params of the next top-level connection
		if (!params.bouncerNetwork) {
			this.update({ connectParams: merged });
		}

		const client = new Client({
			url: resolveServerURL(merged.url, window.location),
			nick: merged.nick || "",
			username: merged.username || merged.nick || "",
			realname: merged.realname || merged.nick || "",
			pass: merged.pass,
			saslPlain: merged.saslPlain,
			saslExternal: merged.saslExternal,
			saslOauthBearer: merged.saslOauthBearer,
			bouncerNetwork: merged.bouncerNetwork,
			multiplexer,
			ping: merged.ping,
			autojoin: [...merged.autojoin],
			eventPlayback: this.state.settings.bufferEvents !== BufferEventsDisplayMode.HIDE,
		});
		client.debug = this.debug;
		client.present = this.present;
		client.awayMessage = this.state.awayMessage;

		this.clients.set(serverID, client);
		this.setServerState(serverID, { status: client.status });

		let errorID: number | null = null;

		client.addEventListener("status", () => {
			this.setServerState(serverID, { status: client.status });
			switch (client.status) {
				case ClientStatus.DISCONNECTED:
					// Features come back with the caps once registered again
					this.setServerState(serverID, { account: null, features: S.noFeatures });
					this.update((state) => {
						const buffers = new Map(state.buffers);
						state.buffers.forEach((buf) => {
							if (buf.server !== serverID) {
								return;
							}
							buffers.set(buf.id, { ...buf, ...S.leftChannel(buf) });
						});
						return { buffers };
					});
					break;
				case ClientStatus.REGISTERED:
					this.update({ connectForm: false });
					if (errorID) {
						this.dismissError(errorID);
					}
					break;
			}
		});

		client.addEventListener("message", (event) => {
			this.handleMessage(serverID, (event as CustomEvent<MessageEventDetail>).detail.message);
		});

		client.addEventListener("reconnect", () => {
			this.setServerState(serverID, { reconnectAt: client.reconnectAt });
		});

		client.addEventListener("lag", () => {
			this.setServerState(serverID, { lag: client.lag });
		});

		client.addEventListener("error", (event) => {
			const err = (event as CustomEvent).detail;
			errorID = this.showError(err);
			const { saslPlain, saslExternal, saslOauthBearer } = client.params;
			if (
				saslOauthBearer &&
				!saslPlain &&
				!saslExternal &&
				err instanceof IRCError &&
				err.msg.command === irc.ERR_SASLFAIL
			) {
				this.handleOauth2TokenRejected(client);
			}
		});

		this.createBuffer(serverID, SERVER_BUFFER);
		if (!this.state.activeBuffer) {
			this.switchBuffer({ server: serverID, name: SERVER_BUFFER });
		}

		if (merged.autojoin.length > 0) {
			this.switchToChannel = { server: serverID, name: merged.autojoin[0] };
		}

		return serverID;
	}

	disconnect(serverID?: number | null): void {
		if (!serverID) {
			serverID = S.getActiveServerID(this.state);
		}
		if (!serverID) {
			return;
		}

		// Keep the client around, so that the server can be reconnected
		this.clients.get(serverID)?.disconnect();
	}

	reconnect(serverID?: number | null): void {
		if (!serverID) {
			serverID = S.getActiveServerID(this.state);
		}

		const client = this.getClient(serverID);
		if (client) {
			// A manual reconnect also resumes reconnecting after drops, which
			// /disconnect or a fatal error turned off
			client.autoReconnect = true;
			client.reconnect();
		}
	}

	typingState: { buffer: number | null; lastSent: number; status: string } = {
		buffer: null,
		lastSent: 0,
		status: "done",
	};

	/**
	 * Detach a channel on soju: the bouncer stays in it and keeps logging,
	 * but it's hidden from clients until joined again.
	 */

	handleMessage(serverID: number, msg: Message): void {
		const client = this.clients.get(serverID);
		if (!client) {
			return;
		}

		if (
			irc.findBatchByType(msg, "chathistory") ||
			irc.findBatchByType(msg, "soju.im/search") ||
			irc.findBatchByType(msg, "search")
		) {
			return; // Handled by the caller
		}

		const destBuffers = this.routeMessage(serverID, msg);

		try {
			this.update((state) => S.handleMessage(state, msg, serverID, client));
		} catch (err) {
			console.error("Failed to handle message:", msg, err);
		}

		const from = msg.prefix?.name ?? "*";
		switch (msg.command) {
			case irc.RPL_WELCOME:
				this.fetchBacklog(serverID).catch((err) => {
					console.error("Failed to fetch backlog:", err);
				});
				break;
			case irc.RPL_ENDOFMOTD:
			case irc.ERR_NOMOTD:
				this.handleEndOfRegistration(serverID, client);
				break;
			case "JOIN": {
				const channel = msg.params[0];

				if (client.isMyNick(from)) {
					this.syncBufferUnread(serverID, channel);
					const buf = S.getBuffer(this.state, { server: serverID, name: channel });
					if (buf && buf.id === this.state.activeBuffer && client.hasNoImplicitNames()) {
						this.fetchNames(buf);
					}
				}
				const switchTo = this.switchToChannel;
				if (
					switchTo &&
					client.isMyNick(from) &&
					(switchTo.server === null || switchTo.server === serverID) &&
					client.cm(channel) === client.cm(switchTo.name)
				) {
					this.switchBuffer({ server: serverID, name: channel });
					this.switchToChannel = null;
				}
				break;
			}
			case "BOUNCER":
				this.handleBouncerNetwork(serverID, client, msg);
				break;
			case "RENAME": {
				const [from, to] = msg.params;
				const stored = this.bufferStore.get({ name: from, server: storeServer(client) });
				if (stored) {
					this.bufferStore.delete({ name: from, server: storeServer(client) });
					this.bufferStore.put({ ...stored, name: to, server: storeServer(client) });
				}
				const buf = S.getBuffer(this.state, { server: serverID, name: to });
				if (buf && buf.id === this.state.activeBuffer) {
					this.updateWindowHash();
					this.updateDocumentTitle();
				}
				break;
			}
			case "BATCH": {
				if (!msg.params[0].startsWith("-")) {
					break;
				}
				const name = msg.params[0].slice(1);
				const batch = client.batches.get(name);
				if (!batch || batch.type !== "soju.im/bouncer-networks") {
					break;
				}

				// We've received a BOUNCER NETWORK batch. If we have a URL to
				// auto-open and no existing network matches it, ask the user to
				// create a new network.
				if (
					this.autoOpenURL &&
					this.autoOpenURL.host &&
					// The URL may have a port, the networks' hosts don't
					!this.findBouncerNetIDByHost(splitHostPort(this.autoOpenURL.host).host)
				) {
					this.openURL(this.autoOpenURL);
					this.autoOpenURL = null;
				}
				break;
			}
			case "MARKREAD":
				this.handleMarkRead(serverID, client, msg);
				break;
			case "TAGMSG":
				this.handleTagMessage(serverID, msg);
				break;
			default:
				// A forward (ERR_LINKCHANNEL) is followed by a JOIN elsewhere,
				// it's not a failure
				if (
					irc.isError(msg.command) &&
					msg.command !== irc.ERR_NOMOTD &&
					msg.command !== irc.ERR_LINKCHANNEL &&
					!msg.internal
				) {
					const description = msg.params[msg.params.length - 1];
					this.showError(description);
				}
		}

		for (const bufName of destBuffers) {
			this.handleChatMessage(serverID, bufName, msg);
		}
	}

	handleConnectSubmit(connectParams: Partial<ConnectParams>): void {
		this.dismissError();

		// Disconnect previous server, if any. This clears the stored
		// autoconnect params, so store the new ones afterwards.
		const activeBuffer = S.getBuffer(this.state, this.state.activeBuffer);
		if (activeBuffer) {
			this.close({ server: activeBuffer.server, name: SERVER_BUFFER });
		}

		if (connectParams.autoconnect) {
			store.autoconnect.put(connectParams);
		} else {
			store.autoconnect.put(null);
		}

		if (this.config.server?.auth === "oauth2" && !connectParams.saslOauthBearer) {
			// No token yet, or it was rejected: authorize, the page is then
			// loaded again with a new one
			void this.redirectOauth2Authorize();
			return;
		}

		this.connect(connectParams);
	}

	/**
	 * Send a PRIVMSG or NOTICE, and show it if the server won't echo it.
	 * Returns false if it couldn't be sent.
	 */

	/**
	 * Record that missed messages weren't all fetched: those between the
	 * last loaded message and the oldest of the fetched page. Without loaded
	 * messages, they are fetched as older history instead.
	 */

	/**
	 * Mark the user as away while the page stays hidden, see draft/pre-away.
	 * Briefly switching tabs doesn't count.
	 */

	/**
	 * Find a buffer by name when its server isn't known: on the active server
	 * first, otherwise the one with the most important unread state.
	 */

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
		BuffersMethods,
		NotificationsMethods,
		RoutingMethods,
		HistoryMethods,
		NetworkMethods,
		MessagingMethods,
		DialogsMethods,
		WindowMethods {}
Object.assign(
	AppController.prototype,
	startupMethods,
	buffersMethods,
	notificationsMethods,
	routingMethods,
	historyMethods,
	networkMethods,
	messagingMethods,
	dialogsMethods,
	windowMethods,
);
