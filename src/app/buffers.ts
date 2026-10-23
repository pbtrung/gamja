/** Buffers: creating, switching, reading, opening and closing them. */

import * as irc from "../lib/irc";
import type Client from "../lib/client";
import { ClientStatus, type WhoxField } from "../lib/client";
import * as S from "../state";
import { SERVER_BUFFER, BufferType, ReceiptType, Unread, type Buffer, type BufferID } from "../state";
import * as store from "../store";
import { splitHostPort } from "./config";
import type AppController from "./controller";
import { getReceipt, storeServer, type HistoryBatch } from "./history";

/** User details requested with WHO, see User in state.ts */
const WHO_FIELDS: WhoxField[] = ["flags", "hostname", "nick", "realname", "username", "account"];

/** Whether the side panes cover the whole screen, see styles/index.css */
function isSmallScreen(): boolean {
	return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 640px)").matches;
}

export const buffersMethods = {
	syncBufferUnread(this: AppController, serverID: number, name: string): void {
		const client = this.clients.get(serverID)!;

		const stored = this.bufferStore.get({ name, server: storeServer(client) });
		if (client.caps.enabled.has("draft/chathistory") && stored) {
			this.setBufferState({ server: serverID, name }, { unread: stored.unread });
			this.updateDocumentTitle();
		}

		this.bufferStore.put({
			name,
			server: storeServer(client),
			closed: false,
		});
	},

	createBuffer(this: AppController, serverID: number, name: string): number {
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
	},

	sendReadReceipt(this: AppController, client: Client, storedBuffer: store.BufferUpdate): void {
		if (!client.supportsReadMarker() || client.status !== ClientStatus.REGISTERED) {
			return;
		}
		const readReceipt = storedBuffer.receipts?.[ReceiptType.READ];
		if (storedBuffer.name === SERVER_BUFFER || !readReceipt) {
			return;
		}
		client.setReadMarker(storedBuffer.name, readReceipt.time);
	},

	storeReceipts(
		this: AppController,
		client: Client,
		update: store.BufferUpdate,
		batch?: HistoryBatch,
	): void {
		if (!this.bufferStore.put(update)) {
			return;
		}
		if (!batch) {
			this.sendReadReceipt(client, update);
		} else if (update.receipts?.[ReceiptType.READ]) {
			batch.readMarkers.set(client.cm(update.name), update);
		}
	},

	switchBuffer(this: AppController, id: BufferID): void {
		const buf = S.getBuffer(this.state, id);
		if (!buf) {
			return;
		}

		const client = this.clients.get(buf.server);
		const stored = client
			? this.bufferStore.get({ name: buf.name, server: storeServer(client) })
			: undefined;
		const prevReadReceipt = getReceipt(stored, ReceiptType.READ);
		const isInitialSwitch = !this.state.activeBuffer;
		const prevActive = this.state.activeBuffer;

		this.update((state) => ({
			activeBuffer: buf.id,
			replyTo: state.replyTo?.buffer === buf.id ? state.replyTo : null,
			...S.updateBuffer(state, buf.id, { prevReadReceipt }),
			openPanels: { ...state.openPanels, bufferList: false },
		}));
		if (prevActive !== null && prevActive !== buf.id) {
			// It may have been left scrolled up with older messages loaded
			this.trimBuffer(prevActive);
		}

		// On small screens, focusing would pop up the on-screen keyboard over
		// the messages the user just switched to read
		if (!isSmallScreen()) {
			this.ui.focusComposer?.();
		}

		const server = this.state.servers.get(buf.server);
		if (client && client.status === ClientStatus.REGISTERED) {
			if (buf.type === BufferType.NICK && !buf.hasInitialWho && server && !server.users.has(buf.name)) {
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
	},

	/** Request the member list of a channel when the server doesn't send it on JOIN. */
	fetchNames(this: AppController, buf: Buffer): void {
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
	},

	markBufferAsRead(this: AppController, id: BufferID): void {
		const buf = S.getBuffer(this.state, id);
		if (!buf) {
			return;
		}
		this.setBufferState(buf.id, { unread: Unread.NONE });

		const client = this.clients.get(buf.server);
		if (!client) {
			return;
		}

		this.closeNotifications(buf.server, client, buf.name);

		// Stored even without messages loaded, or the unread state would
		// come back on reload
		const update: store.BufferUpdate = {
			name: buf.name,
			server: storeServer(client),
			unread: Unread.NONE,
		};
		const lastMsg = buf.messages.at(-1);
		// Missed messages not fetched yet haven't been read
		if (lastMsg && !buf.gap) {
			update.receipts = { [ReceiptType.READ]: S.receiptFromMessage(lastMsg) };
		}
		this.storeReceipts(client, update);

		this.updateDocumentTitle();
	},

	/** Open an irc:// URL. Returns false if the URL couldn't be handled. */
	openURL(this: AppController, url: string | irc.IRCURL | null): boolean {
		if (typeof url === "string") {
			url = irc.parseURL(url);
		}
		if (!url) {
			return false;
		}

		const { host, port } = splitHostPort(url.host);

		let serverID: number | null;
		if (!url.host) {
			serverID = S.getActiveServerID(this.state);
		} else {
			if (!this.findBouncerNetIDByHost(host)) {
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

			serverID = this.serverIDFromHost(host);
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
	},

	/**
	 * Query a user of a conversation: their details, presence and our read
	 * marker. Once per connection, unless the WHO fails: switching to the
	 * conversation again doesn't query an unknown (e.g. offline) user again.
	 */
	whoUserBuffer(this: AppController, target: string, serverID: number): void {
		const client = this.clients.get(serverID);
		if (!client || client.status !== ClientStatus.REGISTERED) {
			return;
		}

		const id = { server: serverID, name: target };
		this.setBufferState(id, { hasInitialWho: true });
		client.who(target, { fields: WHO_FIELDS }).catch((err) => {
			console.warn(`Failed to WHO ${target}:`, err);
			this.setBufferState(id, { hasInitialWho: false });
		});
		client.monitor(target);

		if (client.supportsReadMarker()) {
			client.fetchReadMarker(target);
		}
	},

	async whoChannelBuffer(this: AppController, target: string, serverID: number): Promise<void> {
		const client = this.clients.get(serverID)!;

		// Prevent multiple WHO commands for the same channel in parallel
		this.setBufferState({ name: target, server: serverID }, { hasInitialWho: true });

		let hasInitialWho = false;
		try {
			await client.who(target, { fields: WHO_FIELDS });
			hasInitialWho = true;
		} finally {
			this.setBufferState({ name: target, server: serverID }, { hasInitialWho });
		}
	},

	/** Open a buffer for a channel or nick, joining channels. */
	open(this: AppController, target: string, serverID?: number | null, password?: string): void {
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
			const switchTo = { server: serverID, name: target };
			this.switchToChannel = switchTo;
			client
				.join(target, password)
				.then((joined) => {
					// Forwarded to another channel (ERR_LINKCHANNEL): its JOIN
					// didn't match, switch to it now
					if (this.switchToChannel === switchTo) {
						this.switchToChannel = null;
						this.switchBuffer({ server: serverID, name: joined });
					}
				})
				.catch((err) => {
					this.showError(err);
				});
		} else {
			this.createBuffer(serverID, target);
			this.whoUserBuffer(target, serverID);
			this.switchBuffer({ server: serverID, name: target });
		}
	},

	close(this: AppController, id: BufferID): void {
		const buf = S.getBuffer(this.state, id);
		if (!buf) {
			return;
		}

		if (buf.type === BufferType.SERVER) {
			this.closeServer(buf.server);
		} else {
			this.closeBuffer(buf);
		}
	},

	/** Disconnect from a server and remove it with its buffers. */
	closeServer(this: AppController, serverID: number): void {
		const client = this.clients.get(serverID);
		this.update((state) => {
			const buffers = new Map(state.buffers);
			for (const [id, b] of state.buffers) {
				if (b.server === serverID) {
					buffers.delete(id);
				}
			}

			let activeBuffer = state.activeBuffer;
			if (activeBuffer && state.buffers.get(activeBuffer)?.server === serverID) {
				activeBuffer = buffers.size > 0 ? buffers.keys().next().value! : null;
			}

			return { buffers, activeBuffer };
		});

		// From the server state rather than the caps, which are gone
		// while disconnected
		const disconnectAll =
			client && !client.params.bouncerNetwork && Boolean(this.state.servers.get(serverID)?.isBouncer);
		const isFirstServer = this.state.servers.keys().next().value === serverID;

		this.disconnect(serverID);
		this.clients.delete(serverID);

		this.update((state) => {
			const servers = new Map(state.servers);
			servers.delete(serverID);

			let connectForm = state.connectForm;
			if (servers.size === 0) {
				connectForm = true;
			}

			return { servers, connectForm };
		});

		if (disconnectAll) {
			for (const id of [...this.clients.keys()]) {
				this.closeServer(id);
			}
			this.bufferStore.clear();
		} else if (client) {
			this.bufferStore.clear(storeServer(client));
		}

		// TODO: only clear autoconnect if this server is stored there
		if (isFirstServer) {
			store.autoconnect.put(null);
		}

		if (this.state.activeBuffer) {
			this.switchBuffer(this.state.activeBuffer);
		}
	},

	/** Close a channel or a conversation, leaving the channel. */
	closeBuffer(this: AppController, buf: Buffer): void {
		const client = this.clients.get(buf.server);
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
				server: storeServer(client),
				closed: true,
			});
		}
	},

	disconnectAll(this: AppController): void {
		for (const buf of [...this.state.buffers.values()]) {
			if (buf.type === BufferType.SERVER) {
				this.close(buf.id);
			}
		}
	},

	/** Collapse or expand a network's buffers in the buffer list, or all networks. */
	toggleCollapsed(this: AppController, serverID: number, all = false): void {
		const server = this.state.servers.get(serverID);
		if (!server) {
			return;
		}
		const key = S.getServerKey(server);
		const collapse = !this.state.collapsedNetworks.has(key);
		const keys = all ? [...this.state.servers.values()].map(S.getServerKey) : [key];
		const collapsedNetworks = new Set(this.state.collapsedNetworks);
		for (const k of keys) {
			if (collapse) {
				collapsedNetworks.add(k);
			} else {
				collapsedNetworks.delete(k);
			}
		}
		store.collapsedNetworks.put([...collapsedNetworks]);
		this.update({ collapsedNetworks });
	},

	setOpenPanel(this: AppController, panel: "bufferList" | "memberList", open: boolean | "toggle"): void {
		this.update((state) => ({
			openPanels: {
				...state.openPanels,
				[panel]: open === "toggle" ? !state.openPanels[panel] : open,
			},
		}));
	},

	handleJoinClick(this: AppController, buf: Buffer): void {
		switch (buf.type) {
			case BufferType.SERVER:
				this.openDialog({ kind: "join", server: buf.server });
				break;
			case BufferType.CHANNEL:
				this.getConnectedClient(buf.server)?.send({ command: "JOIN", params: [buf.name] });
				break;
		}
	},

	/** Switch to the buffer of a window hash route. Returns false if not found. */
	openRoute(this: AppController, { host, entity }: { host?: string; entity: string }): boolean {
		let buf: Buffer | undefined;
		if (host) {
			const serverID = this.serverIDFromHost(host);
			if (serverID === null) {
				console.error(`No network found with host "${host}"`);
				return false;
			}
			buf = S.getBuffer(this.state, { server: serverID, name: entity });
		} else {
			// Without a host, it's on the server not bound to a bouncer
			// network, or on any server for links which don't know the host
			// (e.g. push notifications)
			let rootID: number | undefined;
			for (const [id, server] of this.state.servers) {
				if (!server.bouncerNetID) {
					rootID = id;
					break;
				}
			}
			buf =
				S.getBuffer(this.state, { server: rootID, name: entity }) ??
				this.findBufferOnAnyServer(entity);
		}

		if (!buf) {
			console.error(`No buffer found with entity "${entity || "<none>"}"`);
			return false;
		}
		this.switchBuffer(buf.id);
		return true;
	},

	findBufferOnAnyServer(this: AppController, name: string): Buffer | undefined {
		const activeServerID = S.getActiveServerID(this.state);
		let found: Buffer | undefined;
		for (const serverID of this.state.servers.keys()) {
			const buf = S.getBuffer(this.state, { server: serverID, name });
			if (!buf) {
				continue;
			}
			if (serverID === activeServerID) {
				return buf;
			}
			if (!found || S.compareUnread(buf.unread, found.unread) > 0) {
				found = buf;
			}
		}
		return found;
	},
};

export type BuffersMethods = typeof buffersMethods;
