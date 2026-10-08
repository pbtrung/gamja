import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import Client, { ClientStatus, type MessageEventDetail } from "../lib/client";
import * as oauth2 from "../lib/oauth2";
import { strip as stripANSI } from "../lib/ansi";
import * as S from "../state";
import {
	SERVER_BUFFER,
	BufferType,
	ReceiptType,
	Unread,
	BufferEventsDisplayMode,
	type Buffer,
	type BufferID,
	type Receipt,
	type Settings,
	type State,
	type Updater,
	type Server,
} from "../state";
import * as store from "../store";
import commands from "../commands";
import * as webpush from "./webpush";
import { applyTheme } from "../themes";
import { createAppStore, type AppState, type AppStore, type ConnectParams, type Dialog } from "./store";
import {
	fetchConfig,
	formatWindowHash,
	parseQueryString,
	parseWindowHash,
	randomNick,
	resolveServerURL,
	splitHostPort,
	type Config,
} from "./config";

const CHATHISTORY_MAX_SIZE = 4000;

function getReceipt(stored: store.StoredBuffer | undefined, type: ReceiptType): Receipt | null {
	return stored?.receipts?.[type] ?? null;
}

function getLatestReceipt(
	bufferStore: store.BufferStore,
	server: store.StoredServer,
	type: ReceiptType,
): Receipt | null {
	let last: Receipt | null = null;
	for (const buf of bufferStore.list(server)) {
		if (buf.name === SERVER_BUFFER) {
			continue;
		}
		const receipt = getReceipt(buf, type);
		if (S.isReceiptBefore(last, receipt)) {
			last = receipt;
		}
	}
	return last;
}

interface MessageNotification extends Notification {
	data: { bufferName: string; message: Message };
}

function showNotification(title: string, options: NotificationOptions): MessageNotification | null {
	if (!("Notification" in globalThis) || Notification.permission !== "granted") {
		return null;
	}

	// This can still fail due to:
	// https://bugs.chromium.org/p/chromium/issues/detail?id=481856
	try {
		return new Notification(title, options) as MessageNotification;
	} catch (err) {
		console.error("Failed to show notification: ", err);
		return null;
	}
}

let lastErrorID = 0;

export interface ControllerOptions {
	/** Fetch config.json on start, defaults to true */
	config?: Config | null;
	location?: Location;
}

/**
 * Owns the IRC connections and drives the application state. React
 * components read the state from `store` and call methods on the controller.
 */
export default class AppController {
	store: AppStore;
	config: Config = { server: {} };
	clients = new Map<number, Client>();
	bufferStore = new store.BufferStore();
	debug = !import.meta.env.PROD;
	switchToChannel: string | null = null;
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
	/** Browser APIs for Web Push, null if unsupported */
	pushEnv: webpush.PushEnvironment | null = webpush.getPushEnvironment();
	/** Hooks provided by the UI */
	ui: { focusComposer?: () => void } = {};

	constructor(appStore: AppStore = createAppStore()) {
		this.store = appStore;

		const settings = store.settings.load();
		if (settings) {
			this.update((state) => ({ settings: { ...state.settings, ...settings } }));
		}
		applyTheme(this.state.settings.theme);
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
	async handleConfig(config: Config): Promise<void> {
		let connectParams: ConnectParams = { ...this.state.connectParams };

		if (typeof config.server.url === "string") {
			connectParams.url = config.server.url;
		}
		if (Array.isArray(config.server.autojoin)) {
			connectParams.autojoin = config.server.autojoin;
		} else if (typeof config.server.autojoin === "string") {
			connectParams.autojoin = [config.server.autojoin];
		}
		if (typeof config.server.nick === "string") {
			connectParams.nick = config.server.nick;
		}
		if (typeof config.server.autoconnect === "boolean") {
			connectParams.autoconnect = config.server.autoconnect;
		}
		if (config.server.auth === "external") {
			connectParams.saslExternal = true;
		}
		if (typeof config.server.ping === "number") {
			connectParams.ping = config.server.ping;
		}

		if (connectParams.autoconnect && config.server.auth === "mandatory") {
			console.error(
				'Error in config.json: cannot set server.autoconnect = true and server.auth = "mandatory"',
			);
			connectParams.autoconnect = false;
		}
		if (
			config.server.auth === "oauth2" &&
			(!config.oauth2 || !config.oauth2.url || !config.oauth2.client_id)
		) {
			console.error('Error in config.json: server.auth = "oauth2" requires oauth2 settings');
			config.server.auth = null;
		}

		const autoconnect = store.autoconnect.load();
		if (autoconnect) {
			connectParams = {
				...connectParams,
				...autoconnect,
				autoconnect: true,
				autojoin: [], // handled by store.BufferStore
			} as ConnectParams;
		}

		let autojoin: string[] = [];

		const queryParams = parseQueryString(window.location.search);
		// Don't allow to silently override the server URL if there's one in
		// config.json, because this has security implications. But still allow
		// setting server to an empty string to reveal the server field in the
		// connect form.
		if (typeof queryParams.server === "string" && (!connectParams.url || !queryParams.server)) {
			connectParams.url = queryParams.server;

			// When using a custom server, some configuration options don't
			// make sense anymore.
			config.server.auth = null;
		}
		if (typeof queryParams.nick === "string") {
			connectParams.nick = queryParams.nick;
		}
		if (typeof queryParams.channels === "string") {
			autojoin = queryParams.channels.split(",");
		}
		if (typeof queryParams.open === "string") {
			this.autoOpenURL = irc.parseURL(queryParams.open);
		}
		if (queryParams.debug === "1") {
			this.debug = true;
		} else if (queryParams.debug === "0") {
			this.debug = false;
		}

		if (window.location.hash) {
			if (window.location.hash.startsWith("#/")) {
				this.initialRoute = parseWindowHash(window.location.hash);
			} else {
				autojoin = window.location.hash.split(",");
			}
		}

		this.config = config;

		if (!connectParams.nick && connectParams.autoconnect) {
			connectParams.nick = "user-*";
		}
		if (connectParams.nick && connectParams.nick.includes("*")) {
			connectParams.nick = randomNick(connectParams.nick);
		}

		if (config.server.auth === "oauth2" && !connectParams.saslOauthBearer) {
			if (queryParams.error) {
				console.error("OAuth 2.0 authorization failed: ", queryParams.error);
				this.showError(
					"Authentication failed: " + (queryParams.error_description || queryParams.error),
				);
				return;
			}

			if (!queryParams.code) {
				await this.redirectOauth2Authorize();
				return;
			}

			// Strip code from query params, to prevent page refreshes from
			// trying to exchange the code again
			const url = new URL(window.location.toString());
			url.searchParams.delete("code");
			url.searchParams.delete("state");
			window.history.replaceState(null, "", url.toString());

			let saslOauthBearer;
			try {
				const state = typeof queryParams.state === "string" ? queryParams.state : undefined;
				const codeVerifier = oauth2.takePendingAuthorization(state);
				saslOauthBearer = await this.exchangeOauth2Code(queryParams.code, codeVerifier);
			} catch (err) {
				this.showError(err);
				return;
			}

			connectParams.saslOauthBearer = saslOauthBearer;

			if (saslOauthBearer.username && !connectParams.nick) {
				connectParams.nick = saslOauthBearer.username;
			}
		}

		if (autojoin.length > 0) {
			if (connectParams.autoconnect) {
				// Ask the user whether they want to join that new channel.
				// TODO: support multiple channels here
				this.autoOpenURL = { host: "", entity: autojoin[0] };
			} else {
				connectParams.autojoin = autojoin;
			}
		}

		this.update({ loading: false, connectParams });

		if (connectParams.autoconnect) {
			this.update({ connectForm: false });
			this.connect(connectParams);
		}
	}

	async redirectOauth2Authorize(): Promise<void> {
		const oauth2Config = this.config.oauth2!;
		let serverMetadata;
		try {
			serverMetadata = await oauth2.fetchServerMetadata(oauth2Config.url);
		} catch (err) {
			console.error("Failed to fetch OAuth 2.0 server metadata:", err);
			this.showError("Failed to fetch OAuth 2.0 server metadata");
			return;
		}

		await oauth2.redirectAuthorize({
			serverMetadata,
			clientId: oauth2Config.client_id,
			redirectUri: window.location.toString(),
			scope: oauth2Config.scope,
		});
	}

	async exchangeOauth2Code(
		code: string,
		codeVerifier: string,
	): Promise<{ token: string; username: string | null }> {
		const oauth2Config = this.config.oauth2!;
		const serverMetadata = await oauth2.fetchServerMetadata(oauth2Config.url);

		const redirectUri = new URL(window.location.toString());
		redirectUri.searchParams.delete("code");
		redirectUri.searchParams.delete("state");

		const data = await oauth2.exchangeCode({
			serverMetadata,
			redirectUri: redirectUri.toString(),
			code,
			codeVerifier,
			clientId: oauth2Config.client_id,
			clientSecret: oauth2Config.client_secret,
		});

		// TODO: handle expires_in/refresh_token
		const token = data.access_token;

		let username: string | null = null;
		if (serverMetadata.introspection_endpoint) {
			try {
				const data = await oauth2.introspectToken({
					serverMetadata,
					token,
					clientId: oauth2Config.client_id,
					clientSecret: oauth2Config.client_secret,
				});
				username = data.username ?? null;
				if (!username) {
					console.warn("Username missing from OAuth 2.0 token introspection response");
				}
			} catch (err) {
				console.warn("Failed to introspect OAuth 2.0 token:", err);
			}
		}

		return { token, username };
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

	syncBufferUnread(serverID: number, name: string): void {
		const client = this.clients.get(serverID)!;

		const stored = this.bufferStore.get({ name, server: client.params });
		if (client.caps.enabled.has("draft/chathistory") && stored) {
			this.setBufferState({ server: serverID, name }, { unread: stored.unread });
			this.updateDocumentTitle();
		}

		this.bufferStore.put({
			name,
			server: client.params,
			closed: false,
		});
	}

	createBuffer(serverID: number, name: string): number {
		const client = this.clients.get(serverID)!;
		let id = 0;
		let isNew = false;
		this.update((state) => {
			let updated;
			[id, updated] = S.createBuffer(state, name, serverID, client);
			isNew = Boolean(updated);
			return updated;
		});
		if (isNew) {
			this.syncBufferUnread(serverID, name);
		}
		return id;
	}

	sendReadReceipt(client: Client, storedBuffer: store.BufferUpdate): void {
		if (!client.supportsReadMarker() || client.status !== ClientStatus.REGISTERED) {
			return;
		}
		const readReceipt = storedBuffer.receipts?.[ReceiptType.READ];
		if (storedBuffer.name === SERVER_BUFFER || !readReceipt) {
			return;
		}
		client.setReadMarker(storedBuffer.name, readReceipt.time);
	}

	switchBuffer(id: BufferID): void {
		const buf = S.getBuffer(this.state, id);
		if (!buf) {
			return;
		}

		const client = this.clients.get(buf.server);
		const stored = client ? this.bufferStore.get({ name: buf.name, server: client.params }) : undefined;
		const prevReadReceipt = getReceipt(stored, ReceiptType.READ);
		const isInitialSwitch = !this.state.activeBuffer;

		this.update((state) => ({
			activeBuffer: buf.id,
			replyTo: state.replyTo?.buffer === buf.id ? state.replyTo : null,
			...S.updateBuffer(state, buf.id, { prevReadReceipt }),
			openPanels: { ...state.openPanels, bufferList: false },
		}));

		this.ui.focusComposer?.();

		const server = this.state.servers.get(buf.server);
		if (client && client.status === ClientStatus.REGISTERED) {
			if (buf.type === BufferType.NICK && server && !server.users.has(buf.name)) {
				this.whoUserBuffer(buf.name, buf.server);
			}

			if (
				buf.type === BufferType.CHANNEL &&
				buf.joined &&
				!buf.hasNames &&
				client.hasNoImplicitNames()
			) {
				this.fetchNames(buf);
			}

			if (buf.type === BufferType.CHANNEL && !buf.hasInitialWho) {
				this.whoChannelBuffer(buf.name, buf.server).catch((err) => {
					console.warn(`Failed to WHO ${buf.name}:`, err);
				});
			}
		}

		if (!(isInitialSwitch && this.initialRoute)) {
			// If this is the first switch and the hash is already
			// populated, don't overwrite it - leave time for the client to
			// connect and find the appropriate buffer.
			this.updateWindowHash();
		}
		this.updateDocumentTitle();

		// TODO: only mark as read if user scrolled at the bottom
		this.markBufferAsRead(buf.id);
	}

	/** Request the member list of a channel when the server doesn't send it on JOIN. */
	fetchNames(buf: Buffer): void {
		const client = this.clients.get(buf.server);
		if (!client) {
			return;
		}
		// Mark as loaded right away to avoid sending NAMES twice
		this.setBufferState(buf.id, { hasNames: true });
		client.names(buf.name).catch((err) => {
			console.warn(`Failed to fetch NAMES for ${buf.name}:`, err);
			this.setBufferState(buf.id, { hasNames: false });
		});
	}

	markBufferAsRead(id: BufferID): void {
		const buf = S.getBuffer(this.state, id);
		if (!buf) {
			return;
		}
		this.setBufferState(buf.id, { unread: Unread.NONE });

		const client = this.clients.get(buf.server);
		if (!client) {
			return;
		}

		for (const notif of this.messageNotifications) {
			if (client.cm(notif.data.bufferName) === client.cm(buf.name)) {
				notif.close();
			}
		}

		if (buf.messages.length > 0) {
			const lastMsg = buf.messages[buf.messages.length - 1];
			const stored = {
				name: buf.name,
				server: client.params,
				unread: Unread.NONE,
				receipts: { [ReceiptType.READ]: S.receiptFromMessage(lastMsg) },
			};
			if (this.bufferStore.put(stored)) {
				this.sendReadReceipt(client, stored);
			}
		}

		this.updateDocumentTitle();
	}

	updateDocumentTitle(): void {
		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		const server = buf ? this.state.servers.get(buf.server) : undefined;
		const bouncerNetwork = buf ? this.getBouncerNetwork(buf.server) : null;

		let numUnread = 0;
		for (const buffer of this.state.buffers.values()) {
			if (S.compareUnread(buffer.unread, Unread.HIGHLIGHT) >= 0) {
				numUnread++;
			}
		}

		const parts: string[] = [];
		if (buf && buf.type !== BufferType.SERVER) {
			parts.push(buf.name);
		}
		if (server && bouncerNetwork) {
			parts.push(S.getServerName(server, bouncerNetwork));
		}
		parts.push(this.baseTitle);

		let title = "";
		if (numUnread > 0) {
			title = `(${numUnread}) `;
		}
		title += parts.join(" · ");

		document.title = title;
	}

	computeWindowHash(): string {
		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		const bouncerNetwork = buf ? this.getBouncerNetwork(buf.server) : null;
		const host = bouncerNetwork?.host;
		if (!buf) {
			return formatWindowHash(host, null);
		}
		return formatWindowHash(host, buf.type === BufferType.SERVER ? null : buf.name);
	}

	updateWindowHash(): void {
		const hash = this.computeWindowHash();
		if (window.location.hash !== hash) {
			window.history.replaceState(null, "", hash);
		}
	}

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

	handleChatMessage(serverID: number, bufName: string, msg: Message): void {
		const client = this.clients.get(serverID)!;

		this.prepareChatMessage(serverID, msg);

		const stored = this.bufferStore.get({ name: bufName, server: client.params });
		const deliveryReceipt = getReceipt(stored, ReceiptType.DELIVERED);
		const readReceipt = getReceipt(stored, ReceiptType.READ);
		const isDelivered = S.isMessageBeforeReceipt(msg, deliveryReceipt);
		let isRead = S.isMessageBeforeReceipt(msg, readReceipt);
		const from = msg.prefix?.name ?? "*";

		if (client.isMyNick(from)) {
			isRead = true;
		}

		let msgUnread: Unread = Unread.NONE;
		if ((msg.command === "PRIVMSG" || msg.command === "NOTICE") && !isRead) {
			const target = msg.params[0];
			const text = msg.params[1];

			let kind;
			if (msg.isHighlight) {
				msgUnread = Unread.HIGHLIGHT;
				kind = "highlight";
			} else if (client.isMyNick(target)) {
				msgUnread = Unread.HIGHLIGHT;
				kind = "private message";
			} else {
				msgUnread = Unread.MESSAGE;
			}

			if (msgUnread === Unread.HIGHLIGHT && !isDelivered && !irc.parseCTCP(msg)) {
				let title = "New " + kind + " from " + from;
				if (client.isChannel(bufName)) {
					title += " in " + bufName;
				}
				const notif = showNotification(title, {
					body: stripANSI(text),
					requireInteraction: true,
					tag: "msg,server=" + serverID + ",from=" + from + ",to=" + bufName,
					data: { bufferName: bufName, message: msg },
				});
				if (notif) {
					notif.addEventListener("click", () => {
						window.focus();
						this.switchBuffer({ server: serverID, name: bufName });
					});
					notif.addEventListener("close", () => {
						this.messageNotifications.delete(notif);
					});
					this.messageNotifications.add(notif);
				}
			}
		}
		if (msg.command === "INVITE" && client.isMyNick(msg.params[0])) {
			msgUnread = Unread.HIGHLIGHT;

			const channel = msg.params[1];
			const notif = showNotification("Invitation to " + channel, {
				body: from + " has invited you to " + channel,
				requireInteraction: true,
				tag: "invite,server=" + serverID + ",from=" + from + ",channel=" + channel,
			});
			notif?.addEventListener("click", () => {
				window.focus();
				this.switchBuffer({ server: serverID, name: bufName });
			});
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
		this.update((state) => S.addMessage(state, msg, bufID));
		if (msg.command === "PRIVMSG" || msg.command === "NOTICE") {
			this.setBufferState(bufID, (b) =>
				b.typing.size > 0 ? S.applyTyping(b, from, "done", client.cm) : undefined,
			);
		}

		const buf = S.getBuffer(this.state, bufID);
		if (!buf) {
			return;
		}

		// TODO: set unread if scrolled up
		let unread = buf.unread;
		let prevReadReceipt = buf.prevReadReceipt;
		const receipts: store.Receipts = { [ReceiptType.DELIVERED]: S.receiptFromMessage(msg) };

		if (this.state.activeBuffer !== buf.id || !document.hasFocus()) {
			unread = S.unionUnread(unread, msgUnread);
		} else {
			receipts[ReceiptType.READ] = S.receiptFromMessage(msg);
		}

		// Don't show unread marker for my own messages
		if (client.isMyNick(from) && !S.isMessageBeforeReceipt(msg, prevReadReceipt)) {
			prevReadReceipt = S.receiptFromMessage(msg);
		}

		const update = {
			name: buf.name,
			server: client.params,
			unread,
			receipts,
		};
		if (this.bufferStore.put(update)) {
			this.sendReadReceipt(client, update);
		}
		this.setBufferState(buf.id, { unread, prevReadReceipt });

		if (msgUnread === Unread.HIGHLIGHT) {
			this.updateDocumentTitle();
		}
	}

	connect(params: Partial<ConnectParams>): number {
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
		this.update({ connectParams: merged });

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
			ping: merged.ping,
			autojoin: [...merged.autojoin],
			eventPlayback: this.state.settings.bufferEvents !== BufferEventsDisplayMode.HIDE,
		});
		client.debug = this.debug;

		this.clients.set(serverID, client);
		this.setServerState(serverID, { status: client.status });

		let errorID: number | null = null;

		client.addEventListener("status", () => {
			this.setServerState(serverID, { status: client.status });
			switch (client.status) {
				case ClientStatus.DISCONNECTED:
					this.setServerState(serverID, { account: null });
					this.update((state) => {
						const buffers = new Map(state.buffers);
						state.buffers.forEach((buf) => {
							if (buf.server !== serverID) {
								return;
							}
							buffers.set(buf.id, { ...buf, joined: false, hasInitialWho: false });
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

		client.addEventListener("error", (event) => {
			errorID = this.showError((event as CustomEvent).detail);
		});

		this.createBuffer(serverID, SERVER_BUFFER);
		if (!this.state.activeBuffer) {
			this.switchBuffer({ server: serverID, name: SERVER_BUFFER });
		}

		if (merged.autojoin.length > 0) {
			this.switchToChannel = merged.autojoin[0];
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

		const client = this.clients.get(serverID);
		if (client) {
			this.clients.delete(serverID);
			client.disconnect();
		}
	}

	reconnect(serverID?: number | null): void {
		if (!serverID) {
			serverID = S.getActiveServerID(this.state);
		}

		const client = this.getClient(serverID);
		if (client) {
			client.reconnect();
		}
	}

	serverFromBouncerNetwork(bouncerNetworkID: string): number | null {
		for (const [id, client] of this.clients) {
			if (client.params.bouncerNetwork === bouncerNetworkID) {
				return id;
			}
		}
		return null;
	}

	/** Find the buffer name for a PRIVMSG, NOTICE or TAGMSG. */
	resolveMessageTarget(serverID: number, msg: Message): string {
		const client = this.clients.get(serverID)!;
		const from = msg.prefix?.name ?? "*";
		let target = msg.params[0];
		if (client.isMyNick(target)) {
			if (client.cm(from) === client.cm(client.serverPrefix.name)) {
				target = SERVER_BUFFER;
			} else {
				const context = msg.tags["+draft/channel-context"];
				if (
					context &&
					client.isChannel(context) &&
					S.getBuffer(this.state, { server: serverID, name: context })
				) {
					target = context;
				} else {
					target = from;
				}
			}
		}

		const allowedPrefixes = client.isupport.statusMsg();
		if (allowedPrefixes) {
			const parts = irc.parseTargetPrefix(target, allowedPrefixes);
			if (client.isChannel(parts.name)) {
				target = parts.name;
			}
		}
		return target;
	}

	/** Handle client-only tags: reactions and typing notifications. */
	handleTagMessage(serverID: number, msg: Message): void {
		const client = this.clients.get(serverID);
		if (!client || !msg.prefix) {
			return;
		}
		const from = msg.prefix.name;
		const target = this.resolveMessageTarget(serverID, msg);
		const buf = S.getBuffer(this.state, { server: serverID, name: target });
		if (!buf) {
			return;
		}

		const replyTo = msg.tags["+draft/reply"];
		const react = msg.tags["+draft/react"];
		const unreact = msg.tags["+draft/unreact"];
		if (replyTo && (react || unreact)) {
			this.setBufferState(buf.id, (b) =>
				S.applyReaction(b, replyTo, (react || unreact)!, from, Boolean(react), client.cm),
			);
		}

		const typing = msg.tags["+typing"];
		if (typing && !client.isMyNick(from) && !irc.findBatchByType(msg, "chathistory")) {
			this.setBufferState(buf.id, (b) => S.applyTyping(b, from, typing, client.cm));
		}
	}

	/** Whether the server relays a client-only tag (without the "+" prefix). */
	canSendClientTag(client: Client | undefined, tag: string): boolean {
		return (
			Boolean(client?.caps.enabled.has("message-tags")) && irc.isClientTagAllowed(client!.isupport, tag)
		);
	}

	canReact(serverID: number): boolean {
		return Boolean(this.state.servers.get(serverID)?.features.reactions);
	}

	canReply(serverID: number): boolean {
		return Boolean(this.state.servers.get(serverID)?.features.replies);
	}

	canRedact(serverID: number): boolean {
		return Boolean(this.state.servers.get(serverID)?.features.redaction);
	}

	/** Toggle a reaction on a message. */
	react(bufID: number, msg: Message, emoji: string): void {
		const buf = S.getBuffer(this.state, bufID);
		const client = buf ? this.clients.get(buf.server) : undefined;
		const msgid = msg.tags.msgid;
		if (!buf || !client || !msgid || !client.nick) {
			return;
		}
		const nicks = buf.reactions.get(msgid)?.get(emoji) ?? [];
		const remove = nicks.some((n) => client.isMyNick(n));
		const tag = remove ? "+draft/unreact" : "+draft/react";
		client.send({ command: "TAGMSG", params: [buf.name], tags: { [tag]: emoji, "+draft/reply": msgid } });
		if (!client.caps.enabled.has("echo-message")) {
			this.setBufferState(buf.id, (b) =>
				S.applyReaction(b, msgid, emoji, client.nick!, !remove, client.cm),
			);
		}
	}

	startReply(bufID: number, msg: Message): void {
		if (!msg.tags.msgid) {
			return;
		}
		const text = irc.parseCTCP(msg)?.param ?? msg.params[1] ?? "";
		this.update({
			replyTo: {
				buffer: bufID,
				msgid: msg.tags.msgid,
				nick: msg.prefix?.name ?? "*",
				text: stripANSI(text),
			},
		});
		this.ui.focusComposer?.();
	}

	cancelReply(): void {
		this.update({ replyTo: null });
	}

	/** Delete a message (draft/message-redaction). */
	redact(bufID: number, msg: Message, reason?: string): void {
		const buf = S.getBuffer(this.state, bufID);
		const client = buf ? this.clients.get(buf.server) : undefined;
		if (!buf || !client || !msg.tags.msgid) {
			return;
		}
		const params = [buf.name, msg.tags.msgid];
		if (reason) {
			params.push(reason);
		}
		client.send({ command: "REDACT", params });
	}

	typingState: { buffer: number | null; lastSent: number; status: string } = {
		buffer: null,
		lastSent: 0,
		status: "done",
	};

	/** Notify the server of the composer state, throttled per the +typing spec. */
	notifyTyping(text: string): void {
		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		if (!buf || buf.type === BufferType.SERVER || text.startsWith("/")) {
			return;
		}
		const client = this.clients.get(buf.server);
		if (
			!client ||
			client.status !== ClientStatus.REGISTERED ||
			!this.canSendClientTag(client, "typing")
		) {
			return;
		}

		const status = text ? "active" : "done";
		const now = Date.now();
		const prev = this.typingState;
		if (
			prev.buffer === buf.id &&
			prev.status === status &&
			(status === "done" || now - prev.lastSent < 3000)
		) {
			return;
		}
		if (status === "done" && (prev.buffer !== buf.id || prev.status === "done")) {
			return;
		}
		this.typingState = { buffer: buf.id, lastSent: now, status };
		client.send({ command: "TAGMSG", params: [buf.name], tags: { "+typing": status } });
	}

	/** Open the search dialog for the active server. */
	openSearch(scope: "buffer" | "all" = "buffer", query?: string): void {
		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		if (!buf) {
			return;
		}
		const server = this.state.servers.get(buf.server);
		if (!server?.features.search) {
			this.showError("This server doesn't support searching messages");
			return;
		}
		const inBuffer = scope === "buffer" && buf.type !== BufferType.SERVER ? buf.name : null;
		this.openDialog({ kind: "search", server: buf.server, buffer: inBuffer, query });
	}

	/** Search messages on a server. Results are sorted newest first. */
	async searchMessages(
		serverID: number,
		query: { text: string; in?: string | null; from?: string | null },
	): Promise<{ buffer: string; message: Message }[]> {
		const client = this.clients.get(serverID);
		if (!client) {
			throw new Error("Not connected to server");
		}
		const messages = await client.search({
			text: query.text || undefined,
			in: query.in || undefined,
			from: query.from || undefined,
			limit: 100,
		});
		return messages
			.map((message) => ({ buffer: this.resolveMessageTarget(serverID, message), message }))
			.sort((a, b) => ((a.message.tags.time ?? "") < (b.message.tags.time ?? "") ? 1 : -1));
	}

	/** Open a buffer and scroll to a message, loading history around it if needed. */
	async jumpToMessage(serverID: number, target: string, msgid: string): Promise<void> {
		const client = this.clients.get(serverID);
		if (!client) {
			return;
		}
		if (!S.getBuffer(this.state, { server: serverID, name: target })) {
			this.createBuffer(serverID, target);
		}
		const buf = S.getBuffer(this.state, { server: serverID, name: target })!;
		this.switchBuffer(buf.id);

		const loaded = buf.messages.some((m) => m.tags.msgid === msgid);
		if (!loaded && client.caps.enabled.has("draft/chathistory")) {
			const messages = await client.fetchHistoryAround(target, { msgid }, 50);
			for (const msg of messages) {
				if (msg.command === "TAGMSG") {
					this.handleTagMessage(serverID, msg);
					continue;
				}
				this.prepareChatMessage(serverID, msg);
				this.update((state) => S.addMessage(state, msg, buf.id));
			}
		}
		this.update({ jumpTo: { buffer: buf.id, msgid } });
	}

	/** Find the buffers a message should be displayed in. */
	routeMessage(serverID: number, msg: Message): string[] {
		const client = this.clients.get(serverID)!;
		const chatHistoryBatch = irc.findBatchByType(msg, "chathistory");
		const from = msg.prefix?.name ?? "*";

		// Reply triggered by some command sent by us, not worth displaying to
		// the user
		if (msg.internal) {
			return [];
		}

		let target, channel;
		switch (msg.command) {
			case "MODE":
				target = msg.params[0];
				if (client.isChannel(target)) {
					return [target];
				}
				return [SERVER_BUFFER];
			case "NOTICE":
			case "PRIVMSG": {
				target = this.resolveMessageTarget(serverID, msg);

				// Don't open a new buffer if this is just a NOTICE or a garbage
				// CTCP message
				let openNewBuffer = true;
				if (msg.command !== "PRIVMSG") {
					openNewBuffer = false;
				} else {
					const ctcp = irc.parseCTCP(msg);
					if (ctcp && ctcp.command !== "ACTION") {
						openNewBuffer = false;
					}
				}
				if (!openNewBuffer && !S.getBuffer(this.state, { server: serverID, name: target })) {
					target = SERVER_BUFFER;
				}

				return [target];
			}
			case "JOIN":
				channel = msg.params[0];
				if (!client.isMyNick(from)) {
					return [channel];
				}
				return [];
			case "PART":
			case "KICK":
			case "TOPIC":
				return [msg.params[0]];
			case "RENAME":
				return [msg.params[1]];
			case "QUIT":
			case "NICK": {
				const affectedBuffers: string[] = [];
				if (chatHistoryBatch) {
					affectedBuffers.push(chatHistoryBatch.params[0]);
				} else {
					this.state.buffers.forEach((buf) => {
						if (buf.server !== serverID) {
							return;
						}
						if (
							!buf.members.has(from) &&
							!(buf.type === BufferType.NICK && client.cm(buf.name) === client.cm(from))
						) {
							return;
						}
						affectedBuffers.push(buf.name);
					});
					if (msg.command === "NICK" && client.isMyNick(msg.params[0])) {
						affectedBuffers.push(SERVER_BUFFER);
					}
				}
				return affectedBuffers;
			}
			case "INVITE": {
				channel = msg.params[1];

				// TODO: find a more reliable way to do this
				let bufName = channel;
				if (!S.getBuffer(this.state, { server: serverID, name: channel })) {
					bufName = SERVER_BUFFER;
				}

				return [bufName];
			}
			case irc.RPL_CHANNELMODEIS:
			case irc.RPL_CREATIONTIME:
			case irc.RPL_INVITELIST:
			case irc.RPL_ENDOFINVITELIST:
			case irc.RPL_EXCEPTLIST:
			case irc.RPL_ENDOFEXCEPTLIST:
			case irc.RPL_BANLIST:
			case irc.RPL_ENDOFBANLIST:
			case irc.RPL_QUIETLIST:
			case irc.RPL_ENDOFQUIETLIST:
				return [msg.params[1]];
			case irc.RPL_INVITING:
				return [msg.params[2]];
			case irc.RPL_MONONLINE:
			case irc.RPL_MONOFFLINE:
				return msg.params[1].split(",").map((t) => irc.parsePrefix(t).name);
			case irc.RPL_YOURHOST:
			case irc.RPL_MYINFO:
			case irc.RPL_ISUPPORT:
			case irc.RPL_ENDOFMOTD:
			case irc.ERR_NOMOTD:
			case irc.RPL_AWAY:
			case irc.RPL_NOTOPIC:
			case irc.RPL_TOPIC:
			case irc.RPL_TOPICWHOTIME:
			case irc.RPL_NAMREPLY:
			case irc.RPL_ENDOFNAMES:
			case irc.RPL_SASLSUCCESS:
			case irc.RPL_CHANNEL_URL:
			case "AWAY":
			case "SETNAME":
			case "CHGHOST":
			case "ACCOUNT":
			case "CAP":
			case "AUTHENTICATE":
			case "PING":
			case "PONG":
			case "BATCH":
			case "TAGMSG":
			case "CHATHISTORY":
			case "ACK":
			case "BOUNCER":
			case "MARKREAD":
			case "REDACT":
			case "WEBPUSH":
				// Ignore these
				return [];
			default:
				return [SERVER_BUFFER];
		}
	}

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
				if (this.switchToChannel && client.cm(channel) === client.cm(this.switchToChannel)) {
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
				const stored = this.bufferStore.get({ name: from, server: client.params });
				if (stored) {
					this.bufferStore.delete({ name: from, server: client.params });
					this.bufferStore.put({ ...stored, name: to, server: client.params });
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
					!this.findBouncerNetIDByHost(this.autoOpenURL.host)
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
				if (irc.isError(msg.command) && msg.command !== irc.ERR_NOMOTD && !msg.internal) {
					const description = msg.params[msg.params.length - 1];
					this.showError(description);
				}
		}

		for (const bufName of destBuffers) {
			this.handleChatMessage(serverID, bufName, msg);
		}
	}

	/** Whether Web Push can be enabled: supported by the browser and a server. */
	canEnablePush(): boolean {
		if (!this.pushEnv) {
			return false;
		}
		for (const server of this.state.servers.values()) {
			if (server.features.webPush) {
				return true;
			}
		}
		return false;
	}

	/** Turn Web Push notifications on or off for all connections. */
	async setPushNotifications(enabled: boolean): Promise<void> {
		const env = this.pushEnv;
		if (!env) {
			throw new Error("Push notifications aren't supported by this browser");
		}
		if (enabled) {
			const permission = await env.Notification.requestPermission();
			if (permission !== "granted") {
				throw new Error("Notification permission denied");
			}
			const clients = [...this.clients.values()].filter((c) => c.supportsWebPush());
			if (clients.length === 0) {
				throw new Error("The server doesn't support push notifications");
			}
			const subscription = await webpush.subscribe(env, clients[0].isupport.vapid()!);
			await Promise.all(clients.map((c) => webpush.registerClient(c, subscription)));
		} else {
			const subscription = await webpush.getSubscription(env);
			if (subscription) {
				await Promise.all(
					[...this.clients.values()]
						.filter((c) => c.supportsWebPush())
						.map((c) => c.unregisterWebPush(subscription.endpoint).catch(() => {})),
				);
				await subscription.unsubscribe();
			}
		}
		this.handleSettingsChange({ pushNotifications: enabled });
	}

	/** Re-register the push subscription after connecting, servers may expire them. */
	async refreshPushRegistration(client: Client): Promise<void> {
		if (!this.pushEnv || !this.state.settings.pushNotifications || !client.supportsWebPush()) {
			return;
		}
		if (this.pushEnv.Notification.permission !== "granted") {
			return;
		}
		const subscription = await webpush.subscribe(this.pushEnv, client.isupport.vapid()!);
		await webpush.registerClient(client, subscription);
	}

	handleEndOfRegistration(serverID: number, client: Client): void {
		this.refreshPushRegistration(client).catch((err) => {
			console.warn("Failed to register for push notifications:", err);
		});

		// RPL_ENDOFMOTD and ERR_NOMOTD indicate the end of the ISUPPORT list

		// Restore opened channel and user buffers
		let join: string[] = [];
		for (const buf of this.bufferStore.list(client.params)) {
			if (buf.name === SERVER_BUFFER || buf.closed) {
				continue;
			}

			if (client.isChannel(buf.name)) {
				if (client.caps.enabled.has("soju.im/bouncer-networks")) {
					continue;
				}
				join.push(buf.name);
			} else {
				this.createBuffer(serverID, buf.name);
				this.whoUserBuffer(buf.name, serverID);
			}
		}

		// Auto-join channels given at connect-time
		const bouncerNetwork = this.getBouncerNetwork(serverID);
		if (!bouncerNetwork || bouncerNetwork.state === "connected") {
			join = join.concat(client.params.autojoin || []);
			client.params.autojoin = [];
		}

		if (join.length > 0) {
			client.send({
				command: "JOIN",
				params: [join.join(",")],
			});
		}

		const serverHost = bouncerNetwork?.host ?? "";
		if (this.autoOpenURL && serverHost === this.autoOpenURL.host) {
			const url = this.autoOpenURL;
			this.autoOpenURL = null;

			// Roundtrip to ensure we've seen any server-initiated JOIN
			// messages sent right after connection registration
			client
				.ping()
				.then(() => this.openURL(url))
				.catch(() => {});
		} else if (this.initialRoute && serverHost === (this.initialRoute.host || "")) {
			this.initialRoute = null;

			client
				.ping()
				.then(() => this.handleWindowHashChange())
				.catch(() => {});
		}
	}

	handleBouncerNetwork(serverID: number, client: Client, msg: Message): void {
		if (msg.params[0] !== "NETWORK") {
			return; // We're only interested in network updates
		}

		if (client.isupport.bouncerNetID()) {
			// This can happen if the user has specified a network to bind
			// to via other means, e.g. "<username>/<network>".
			return;
		}

		const id = msg.params[1];
		let attrs: S.BouncerNetwork | null = null;
		if (msg.params[2] !== "*") {
			attrs = irc.parseTags(msg.params[2]);
		}

		let isNew = false;
		this.update((state) => {
			if (!attrs) {
				return S.deleteBouncerNetwork(state, id);
			}
			isNew = !state.bouncerNetworks.has(id);
			return S.storeBouncerNetwork(state, id, attrs);
		});

		if (!attrs) {
			const netServerID = this.serverFromBouncerNetwork(id);
			if (netServerID) {
				this.close({ server: netServerID, name: SERVER_BUFFER });
			}
		} else if (isNew) {
			this.connect({
				...this.state.connectParams,
				nick: client.params.nick,
				username: client.params.username,
				realname: client.params.realname,
				pass: client.params.pass,
				saslPlain: client.params.saslPlain,
				saslExternal: client.params.saslExternal,
				saslOauthBearer: client.params.saslOauthBearer,
				url: client.params.url,
				autojoin: [],
				bouncerNetwork: id,
			});
		}

		if (attrs && attrs.state === "connected") {
			const netServerID = this.serverFromBouncerNetwork(id);
			const netClient = this.getClient(netServerID);
			if (
				netClient &&
				netClient.status === ClientStatus.REGISTERED &&
				netClient.params.autojoin &&
				netClient.params.autojoin.length > 0
			) {
				netClient.send({
					command: "JOIN",
					params: [netClient.params.autojoin.join(",")],
				});
				netClient.params.autojoin = [];
			}
		}
	}

	handleMarkRead(serverID: number, client: Client, msg: Message): void {
		const target = msg.params[0];
		const bound = msg.params[1];
		if (!bound || bound === "*" || !bound.startsWith("timestamp=")) {
			return;
		}
		const readReceipt = { time: bound.replace("timestamp=", "") };
		const stored = this.bufferStore.get({ name: target, server: client.params });
		if (S.isReceiptBefore(readReceipt, getReceipt(stored, ReceiptType.READ))) {
			return;
		}
		for (const notif of this.messageNotifications) {
			if (client.cm(notif.data.bufferName) !== client.cm(target)) {
				continue;
			}
			if (S.isMessageBeforeReceipt(notif.data.message, readReceipt)) {
				notif.close();
			}
		}

		const buf = S.getBuffer(this.state, { server: serverID, name: target });
		let unread: Unread = Unread.NONE;
		if (buf) {
			// Re-compute unread status
			for (let i = buf.messages.length - 1; i >= 0; i--) {
				const m = buf.messages[i];
				if (m.command !== "PRIVMSG" && m.command !== "NOTICE") {
					continue;
				}
				if (S.isMessageBeforeReceipt(m, readReceipt)) {
					break;
				}

				if (m.isHighlight || client.isMyNick(buf.name)) {
					unread = Unread.HIGHLIGHT;
					break;
				}

				unread = Unread.MESSAGE;
			}
			this.setBufferState(buf.id, { unread });
		}

		this.bufferStore.put({
			name: target,
			server: client.params,
			unread,
			closed: !buf,
			receipts: { [ReceiptType.READ]: readReceipt },
		});
		this.updateDocumentTitle();
	}

	async fetchBacklog(serverID: number): Promise<void> {
		const client = this.clients.get(serverID)!;
		if (!client.caps.enabled.has("draft/chathistory")) {
			return;
		}
		if (client.caps.enabled.has("soju.im/bouncer-networks") && !client.params.bouncerNetwork) {
			return;
		}

		const lastReceipt = getLatestReceipt(this.bufferStore, client.params, ReceiptType.DELIVERED);
		if (!lastReceipt) {
			return;
		}

		const now = irc.formatDate(new Date());
		const targets = await client.fetchHistoryTargets(now, lastReceipt.time);
		await Promise.all(
			targets.map(async (target) => {
				let from: Receipt = lastReceipt;
				const to = { time: now };

				// Maybe we've just received a READ update from the
				// server, avoid over-fetching history
				const stored = this.bufferStore.get({ name: target.name, server: client.params });
				const readReceipt = getReceipt(stored, ReceiptType.READ);
				if (S.isReceiptBefore(from, readReceipt)) {
					from = readReceipt!;
				}

				// If we already have messages stored for the target,
				// fetch all messages we've missed
				const buf = S.getBuffer(this.state, { server: serverID, name: target.name });
				if (buf && buf.messages.length > 0) {
					const lastMsg = buf.messages[buf.messages.length - 1];
					from = S.receiptFromMessage(lastMsg);
				}

				// Query read marker if this is a user (ie, we haven't received
				// the read marker as part of a JOIN burst)
				if (client.supportsReadMarker() && client.isNick(target.name)) {
					client.fetchReadMarker(target.name);
				}

				let result;
				try {
					result = await client.fetchHistoryBetween(target.name, from, to, CHATHISTORY_MAX_SIZE);
				} catch (err) {
					console.error("Failed to fetch backlog for '" + target.name + "': ", err);
					this.showError("Failed to fetch backlog for '" + target.name + "'");
					return;
				}

				for (const msg of result.messages) {
					if (msg.command === "TAGMSG") {
						this.handleTagMessage(serverID, msg);
						continue;
					}
					const destBuffers = this.routeMessage(serverID, msg);
					for (const bufName of destBuffers) {
						this.handleChatMessage(serverID, bufName, msg);
					}
				}
			}),
		);
	}

	handleConnectSubmit(connectParams: Partial<ConnectParams>): void {
		this.dismissError();

		if (connectParams.autoconnect) {
			store.autoconnect.put(connectParams);
		} else {
			store.autoconnect.put(null);
		}

		// Disconnect previous server, if any
		const activeBuffer = S.getBuffer(this.state, this.state.activeBuffer);
		if (activeBuffer) {
			this.close({ server: activeBuffer.server, name: SERVER_BUFFER });
		}

		this.connect(connectParams);
	}

	findBouncerNetIDByHost(host: string): string | null {
		for (const [id, bouncerNetwork] of this.state.bouncerNetworks) {
			if (bouncerNetwork.host === host) {
				return id;
			}
		}
		return null;
	}

	/** Open an irc:// URL. Returns false if the URL couldn't be handled. */
	openURL(url: string | irc.IRCURL | null): boolean {
		if (typeof url === "string") {
			url = irc.parseURL(url);
		}
		if (!url) {
			return false;
		}

		const { host, port } = splitHostPort(url.host);

		let serverID: number | null = null;
		if (!url.host) {
			serverID = S.getActiveServerID(this.state);
		} else {
			const bouncerNetID = this.findBouncerNetIDByHost(host);
			if (!bouncerNetID) {
				// Open dialog to create network if bouncer
				const client = this.clients.values().next().value;
				if (!client || !client.caps.enabled.has("soju.im/bouncer-networks")) {
					return false;
				}

				const params: S.BouncerNetwork = { host };
				if (typeof port === "number") {
					params.port = String(port);
				}
				this.openDialog({ kind: "network", params, autojoin: url.entity });
				return true;
			}

			for (const [id, server] of this.state.servers) {
				if (server.bouncerNetID === bouncerNetID) {
					serverID = id;
					break;
				}
			}
		}
		if (!serverID) {
			return false;
		}

		const buf = S.getBuffer(this.state, { server: serverID, name: url.entity || SERVER_BUFFER });
		if (buf) {
			this.switchBuffer(buf.id);
		} else {
			this.openDialog({ kind: "confirm-open-buffer", server: serverID, name: url.entity });
		}
		return true;
	}

	whoUserBuffer(target: string, serverID: number): void {
		const client = this.clients.get(serverID);
		if (!client || client.status !== ClientStatus.REGISTERED) {
			return;
		}

		client
			.who(target, {
				fields: ["flags", "hostname", "nick", "realname", "username", "account"],
			})
			.catch((err) => console.warn(`Failed to WHO ${target}:`, err));
		client.monitor(target);

		if (client.supportsReadMarker()) {
			client.fetchReadMarker(target);
		}
	}

	async whoChannelBuffer(target: string, serverID: number): Promise<void> {
		const client = this.clients.get(serverID)!;

		// Prevent multiple WHO commands for the same channel in parallel
		this.setBufferState({ name: target, server: serverID }, { hasInitialWho: true });

		let hasInitialWho = false;
		try {
			await client.who(target, {
				fields: ["flags", "hostname", "nick", "realname", "username", "account"],
			});
			hasInitialWho = true;
		} finally {
			this.setBufferState({ name: target, server: serverID }, { hasInitialWho });
		}
	}

	/** Open a buffer for a channel or nick, joining channels. */
	open(target: string, serverID?: number | null, password?: string): void {
		if (!serverID) {
			serverID = S.getActiveServerID(this.state);
		}
		const client = this.getClient(serverID);
		if (!client || !serverID) {
			return;
		}

		if (client.isServer(target)) {
			this.switchBuffer({ server: serverID });
		} else if (client.isChannel(target)) {
			const buf = S.getBuffer(this.state, { server: serverID, name: target });
			if (buf?.joined) {
				this.switchBuffer(buf.id);
				return;
			}
			this.switchToChannel = target;
			client.join(target, password).catch((err) => {
				this.showError(err);
			});
		} else {
			this.whoUserBuffer(target, serverID);
			this.createBuffer(serverID, target);
			this.switchBuffer({ server: serverID, name: target });
		}
	}

	close(id: BufferID): void {
		const buf = S.getBuffer(this.state, id);
		if (!buf) {
			return;
		}

		const client = this.clients.get(buf.server);
		switch (buf.type) {
			case BufferType.SERVER: {
				this.update((state) => {
					const buffers = new Map(state.buffers);
					for (const [id, b] of state.buffers) {
						if (b.server === buf.server) {
							buffers.delete(id);
						}
					}

					let activeBuffer = state.activeBuffer;
					if (activeBuffer && state.buffers.get(activeBuffer)?.server === buf.server) {
						activeBuffer = buffers.size > 0 ? buffers.keys().next().value! : null;
					}

					return { buffers, activeBuffer };
				});

				const disconnectAll =
					client &&
					!client.params.bouncerNetwork &&
					client.caps.enabled.has("soju.im/bouncer-networks");
				const isFirstServer = this.state.servers.keys().next().value === buf.server;

				this.disconnect(buf.server);

				this.update((state) => {
					const servers = new Map(state.servers);
					servers.delete(buf.server);

					let connectForm = state.connectForm;
					if (servers.size === 0) {
						connectForm = true;
					}

					return { servers, connectForm };
				});

				if (disconnectAll) {
					for (const serverID of [...this.clients.keys()]) {
						this.close({ server: serverID, name: SERVER_BUFFER });
					}
					this.bufferStore.clear();
				} else if (client) {
					this.bufferStore.clear(client.params);
				}

				// TODO: only clear autoconnect if this server is stored there
				if (isFirstServer) {
					store.autoconnect.put(null);
				}

				if (this.state.activeBuffer) {
					this.switchBuffer(this.state.activeBuffer);
				}
				break;
			}
			case BufferType.CHANNEL:
			case BufferType.NICK:
				if (buf.type === BufferType.CHANNEL && buf.joined && client) {
					client.send({ command: "PART", params: [buf.name] });
				}
				if (this.state.activeBuffer === buf.id) {
					this.switchBuffer({ server: buf.server, name: SERVER_BUFFER });
				}
				this.update((state) => {
					const buffers = new Map(state.buffers);
					buffers.delete(buf.id);
					return { buffers };
				});

				if (client) {
					if (client.status === ClientStatus.REGISTERED) {
						client.unmonitor(buf.name);
					}

					this.bufferStore.put({
						name: buf.name,
						server: client.params,
						closed: true,
					});
				}
				break;
		}
	}

	disconnectAll(): void {
		for (const buf of [...this.state.buffers.values()]) {
			if (buf.type === BufferType.SERVER) {
				this.close(buf.id);
			}
		}
	}

	executeCommand(s: string): void {
		const parts = s.split(" ");
		const name = parts[0].toLowerCase().slice(1);
		const args = parts.slice(1);

		const cmd = commands.get(name);
		if (!cmd) {
			this.showError(`Unknown command "${name}" (run "/help" to get a command list)`);
			return;
		}

		try {
			const result = cmd.execute(this, args);
			if (result instanceof Promise) {
				result.catch((error: Error) => {
					console.error(`Failed to execute command "${name}":`, error);
					this.showError(error.message);
				});
			}
		} catch (error) {
			console.error(`Failed to execute command "${name}":`, error);
			this.showError(error instanceof Error ? error.message : error);
		}
	}

	privmsg(target: string, text: string): void {
		if (target === SERVER_BUFFER) {
			this.showError("Cannot send message in server buffer");
			return;
		}

		const serverID = S.getActiveServerID(this.state);
		const client = this.getClient(serverID);
		if (!client || !serverID) {
			return;
		}

		const msg: Message = { tags: {}, prefix: null, command: "PRIVMSG", params: [target, text] };
		const replyTo = this.state.replyTo;
		const buf = S.getBuffer(this.state, { server: serverID, name: target });
		if (replyTo && buf && replyTo.buffer === buf.id) {
			if (this.canSendClientTag(client, "draft/reply")) {
				msg.tags["+draft/reply"] = replyTo.msgid;
			}
			this.update({ replyTo: null });
		}
		client.send(msg);
		if (this.typingState.buffer === buf?.id) {
			// Sending a message implicitly ends typing
			this.typingState = { buffer: null, lastSent: 0, status: "done" };
		}

		if (!client.caps.enabled.has("echo-message")) {
			msg.prefix = { name: client.nick ?? "" };
			this.handleChatMessage(serverID, target, msg);
		}
	}

	handleComposerSubmit(text: string): void {
		if (!text) {
			return;
		}

		if (text.startsWith("//")) {
			text = text.slice(1);
		} else if (text.startsWith("/")) {
			this.executeCommand(text);
			return;
		}

		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		if (!buf) {
			return;
		}

		this.privmsg(buf.name, text);
	}

	setOpenPanel(panel: "bufferList" | "memberList", open: boolean | "toggle"): void {
		this.update((state) => ({
			openPanels: {
				...state.openPanels,
				[panel]: open === "toggle" ? !state.openPanels[panel] : open,
			},
		}));
	}

	handleJoinClick(buf: Buffer): void {
		switch (buf.type) {
			case BufferType.SERVER:
				this.openDialog({ kind: "join", server: buf.server });
				break;
			case BufferType.CHANNEL:
				this.clients.get(buf.server)?.send({ command: "JOIN", params: [buf.name] });
				break;
		}
	}

	autocomplete(prefix: string): string[] {
		function fromList(l: Iterable<string>, prefix: string): string[] {
			prefix = prefix.toLowerCase();
			const repl: string[] = [];
			for (const item of l) {
				if (item.toLowerCase().startsWith(prefix)) {
					repl.push(item);
				}
			}
			return repl;
		}

		if (prefix.startsWith("/")) {
			const repl = fromList(commands.keys(), prefix.slice(1));
			return repl.map((cmd) => "/" + cmd);
		}

		const client = this.getActiveClient();
		if (client?.isChannel(prefix)) {
			const chanNames: string[] = [];
			for (const buf of this.state.buffers.values()) {
				if (buf.type === BufferType.CHANNEL) {
					chanNames.push(buf.name);
				}
			}
			return fromList(chanNames, prefix);
		}

		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		if (!buf) {
			return [];
		}
		if (buf.type === BufferType.NICK) {
			return fromList([buf.name], prefix);
		}
		return fromList(buf.members.keys(), prefix);
	}

	openHelp(): void {
		this.openDialog({ kind: "help" });
	}

	/** Load a page of older messages in the active buffer. */
	async fetchOlderMessages(retry = false): Promise<void> {
		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		if (!buf || buf.type === BufferType.SERVER) {
			return;
		}

		const client = this.clients.get(buf.server);

		if (
			!client ||
			client.status !== ClientStatus.REGISTERED ||
			!client.caps.enabled.has("draft/chathistory") ||
			!client.caps.enabled.has("server-time")
		) {
			return;
		}
		// soju doesn't advertise CHATHISTORY on the bouncer connection (e.g.
		// for BouncerServ), there is no history to load there
		if (client.isupport.chatHistory() === 0) {
			if (buf.history !== "end") {
				this.setBufferState(buf.id, { history: "end" });
			}
			return;
		}
		if (buf.history === "loading" || buf.history === "end" || (buf.history === "error" && !retry)) {
			return;
		}

		let before;
		if (buf.messages.length > 0) {
			before = buf.messages[0].tags["time"]!;
		} else {
			before = irc.formatDate(new Date());
		}

		// Avoids sending multiple CHATHISTORY commands in parallel
		this.setBufferState(buf.id, { history: "loading" });

		let limit = 100;
		if (client.caps.enabled.has("draft/event-playback")) {
			limit = 200;
		}

		let result;
		try {
			result = await client.fetchHistoryBefore(buf.name, before, limit);
		} catch (err) {
			// Don't retry automatically, the user can retry from the UI
			this.setBufferState(buf.id, { history: "error" });
			throw err;
		}
		this.setBufferState(buf.id, { history: result.more ? "more" : "end" });

		if (result.messages.length > 0) {
			const msg = result.messages[result.messages.length - 1];
			const receipts: store.Receipts = { [ReceiptType.DELIVERED]: S.receiptFromMessage(msg) };
			if (this.state.activeBuffer === buf.id) {
				receipts[ReceiptType.READ] = S.receiptFromMessage(msg);
			}
			const stored = {
				name: buf.name,
				server: client.params,
				receipts,
			};
			if (this.bufferStore.put(stored)) {
				this.sendReadReceipt(client, stored);
			}
			this.setBufferState(buf.id, ({ prevReadReceipt }) => {
				if (!S.isMessageBeforeReceipt(msg, prevReadReceipt)) {
					prevReadReceipt = S.receiptFromMessage(msg);
				}
				return { prevReadReceipt };
			});
		}

		for (const msg of result.messages) {
			if (msg.command === "TAGMSG") {
				this.handleTagMessage(buf.server, msg);
				continue;
			}
			this.prepareChatMessage(buf.server, msg);
			const destBuffers = this.routeMessage(buf.server, msg);
			for (const bufName of destBuffers) {
				const bufID = { server: buf.server, name: bufName };
				this.update((state) => S.addMessage(state, msg, bufID));
			}
		}
	}

	openDialog(dialog: Dialog): void {
		this.update({ dialog });
	}

	dismissDialog(): void {
		this.update({ dialog: null });
	}

	setDialogLoading(promise: Promise<unknown>): void {
		const setLoading = (loading: boolean) => {
			this.update((state) => {
				const dialog = state.dialog;
				if (
					!dialog ||
					(dialog.kind !== "auth" && dialog.kind !== "register" && dialog.kind !== "verify")
				) {
					return;
				}
				return { dialog: { ...dialog, loading } };
			});
		};

		setLoading(true);
		promise.catch((err) => this.showError(err)).finally(() => setLoading(false));
	}

	handleAuthClick(serverID: number): void {
		const client = this.clients.get(serverID);
		this.openDialog({ kind: "auth", server: serverID, username: client?.nick ?? "" });
	}

	handleAuthSubmit(serverID: number, username: string, password: string): void {
		const client = this.clients.get(serverID)!;
		const promise = client.authenticate("PLAIN", { username, password }).then(() => {
			this.dismissDialog();

			const firstClient = this.clients.values().next().value;
			if (client !== firstClient) {
				return;
			}

			let autoconnect = store.autoconnect.load();
			if (!autoconnect) {
				return;
			}

			console.log("Saving SASL PLAIN credentials");
			autoconnect = {
				...autoconnect,
				saslPlain: { username, password },
			};
			store.autoconnect.put(autoconnect);
		});
		this.setDialogLoading(promise);
	}

	handleRegisterClick(serverID: number): void {
		const client = this.clients.get(serverID)!;
		const emailRequired = client.checkAccountRegistrationCap("email-required");
		this.openDialog({ kind: "register", server: serverID, emailRequired });
	}

	handleRegisterSubmit(serverID: number, email: string, password: string): void {
		const client = this.clients.get(serverID)!;
		const promise = client.registerAccount(email, password).then((data) => {
			this.dismissDialog();

			if (data.verificationRequired) {
				this.handleVerifyClick(serverID, data.account, data.message);
			}

			const firstClient = this.clients.values().next().value;
			if (client !== firstClient) {
				return;
			}

			let autoconnect = store.autoconnect.load();
			if (!autoconnect) {
				return;
			}

			console.log("Saving account registration credentials");
			autoconnect = {
				...autoconnect,
				saslPlain: { username: data.account, password },
			};
			store.autoconnect.put(autoconnect);
		});
		this.setDialogLoading(promise);
	}

	handleVerifyClick(serverID: number, account: string, message: string): void {
		this.openDialog({ kind: "verify", server: serverID, account, message });
	}

	handleVerifySubmit(serverID: number, account: string, code: string): void {
		const client = this.clients.get(serverID)!;
		const promise = client.verifyAccount(account, code).then(() => {
			this.dismissDialog();
		});
		this.setDialogLoading(promise);
	}

	handleManageNetworkClick(serverID: number): void {
		const server = this.state.servers.get(serverID);
		const bouncerNetID = server?.bouncerNetID;
		if (!bouncerNetID) {
			return;
		}
		const bouncerNetwork = this.state.bouncerNetworks.get(bouncerNetID);
		this.openDialog({
			kind: "network",
			id: bouncerNetID,
			params: bouncerNetwork,
		});
	}

	/** The connection to the bouncer itself, not bound to a network. */
	getBouncerClient(): Client | undefined {
		for (const client of this.clients.values()) {
			if (!client.params.bouncerNetwork) {
				return client;
			}
		}
		return this.clients.values().next().value;
	}

	async handleNetworkSubmit(
		id: string | undefined,
		attrs: S.BouncerNetwork,
		autojoin: string | null,
	): Promise<void> {
		const client = this.getBouncerClient();
		if (!client) {
			return;
		}

		this.dismissDialog();

		if (id) {
			if (Object.keys(attrs).length === 0) {
				return;
			}

			client.send({
				command: "BOUNCER",
				params: ["CHANGENETWORK", id, irc.formatTags(attrs)],
			});
		} else {
			attrs = { ...attrs, tls: "1" };
			let netID;
			try {
				netID = await client.createBouncerNetwork(attrs);
			} catch (err) {
				this.showError(err);
				return;
			}
			if (!autojoin) {
				return;
			}

			// By this point, bouncer-networks-notify should've advertised
			// the new network
			const serverID = this.serverFromBouncerNetwork(netID);
			const newClient = this.getClient(serverID);
			if (newClient) {
				newClient.params.autojoin = [autojoin];
			}

			this.switchToChannel = autojoin;
		}
	}

	handleNetworkRemove(id: string): void {
		this.getBouncerClient()?.send({
			command: "BOUNCER",
			params: ["DELNETWORK", id],
		});

		this.dismissDialog();
	}

	handleOpenSettingsClick(): void {
		let showProtocolHandler = false;
		for (const client of this.clients.values()) {
			if (client.caps.enabled.has("soju.im/bouncer-networks")) {
				showProtocolHandler = true;
				break;
			}
		}

		this.openDialog({ kind: "settings", showProtocolHandler });
	}

	handleSettingsChange(settings: Partial<Settings>): void {
		const updated = { ...this.state.settings, ...settings };
		store.settings.put(updated as unknown as Record<string, unknown>);
		this.update({ settings: updated });
		if (settings.theme !== undefined) {
			applyTheme(updated.theme);
		}
	}

	handleWindowFocus(): void {
		if (this.state.activeBuffer) {
			// TODO: only do this if scrolled at the bottom
			this.markBufferAsRead(this.state.activeBuffer);
		}

		// When the user focuses gamja, send a PING to make sure we detect any
		// network errors ASAP

		const now = new Date();
		if (this.lastFocusPingDate && now.getTime() - this.lastFocusPingDate.getTime() < 15 * 1000) {
			return;
		}
		this.lastFocusPingDate = now;

		for (const client of this.clients.values()) {
			if (client.status === ClientStatus.REGISTERED) {
				client.send({ command: "PING", params: ["gamja"] });
			}
		}
	}

	handleWindowHashChange(): void {
		if (window.location.hash === this.computeWindowHash()) {
			return;
		}

		const { host, entity } = parseWindowHash(window.location.hash);

		let serverID: number | undefined;
		if (host) {
			const bouncerNetID = this.findBouncerNetIDByHost(host);
			if (!bouncerNetID) {
				console.error(`No network found with host "${host}"`);
				return;
			}

			for (const [id, server] of this.state.servers) {
				if (server.bouncerNetID === bouncerNetID) {
					serverID = id;
					break;
				}
			}
		} else {
			for (const [id, server] of this.state.servers) {
				if (!server.bouncerNetID) {
					serverID = id;
					break;
				}
			}
		}

		const buf = S.getBuffer(this.state, { server: serverID, name: entity });
		if (!buf) {
			console.error(`No buffer found with entity "${entity || "<none>"}"`);
			return;
		}

		this.switchBuffer(buf.id);
	}

	/** Install window event listeners. Returns a cleanup function. */
	attach(): () => void {
		const onFocus = () => this.handleWindowFocus();
		const onHashChange = () => this.handleWindowHashChange();
		const onWorkerMessage = (event: MessageEvent) => this.handleWorkerMessage(event.data);
		window.addEventListener("focus", onFocus);
		window.addEventListener("hashchange", onHashChange);
		this.pushEnv?.serviceWorker.addEventListener("message", onWorkerMessage);
		return () => {
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("hashchange", onHashChange);
			this.pushEnv?.serviceWorker.removeEventListener("message", onWorkerMessage);
		};
	}

	/** Handle messages from the service worker, e.g. a clicked push notification. */
	handleWorkerMessage(data: unknown): void {
		if (!data || typeof data !== "object" || (data as { type?: string }).type !== "open-buffer") {
			return;
		}
		const target = (data as { target?: string }).target;
		if (!target) {
			return;
		}
		for (const buf of this.state.buffers.values()) {
			const client = this.clients.get(buf.server);
			if (client && client.cm(buf.name) === client.cm(target)) {
				this.switchBuffer(buf.id);
				return;
			}
		}
		this.open(target);
	}

	destroy(): void {
		for (const client of this.clients.values()) {
			client.disconnect();
		}
		this.clients.clear();
	}
}

export type { State };
