/** Registration, bouncer networks, soju metadata and Web Push. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import { ClientStatus, MULTIPLEX_CAP } from "../lib/client";
import * as S from "../state";
import { SERVER_BUFFER, BufferType, ReceiptType, Unread, type BufferID } from "../state";
import * as webpush from "./webpush";
import { splitHostPort } from "./config";
import type AppController from "./controller";
import { getReceipt, storeServer } from "./history";

/** Maximum length of the channel list of a JOIN, IRC lines are 512 bytes */
const MAX_JOIN_LENGTH = 400;

/**
 * Join channels with as few JOIN commands as possible, each short enough
 * and with no more channels than the server accepts (TARGMAX). Each channel
 * is joined once: restored and auto-joined channels may be the same.
 */
function joinChannels(client: Client, channels: string[]): void {
	const seen = new Set<string>();
	channels = channels.filter((ch) => {
		const key = client.cm(ch);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
	for (const chunk of irc.chunkTargets(channels, client.isupport.targMax("JOIN"), MAX_JOIN_LENGTH)) {
		client.send({ command: "JOIN", params: [chunk.join(",")] });
	}
}

export const networkMethods = {
	serverFromBouncerNetwork(this: AppController, bouncerNetworkID: string): number | null {
		for (const [id, client] of this.clients) {
			if (client.params.bouncerNetwork === bouncerNetworkID) {
				return id;
			}
		}
		return null;
	},

	/** Pin, mute or block a target, synced to all clients by soju. */
	setTargetMetadata(
		this: AppController,
		serverID: number,
		target: string,
		field: keyof S.TargetMetadata,
		value: boolean,
	): void {
		const client = this.clients.get(serverID);
		if (!client || !this.state.servers.get(serverID)?.features.targetMetadata) {
			throw new Error("Pinning, muting and blocking require the soju bouncer");
		}
		// soju echoes the new value to all clients, including this one
		client.setTargetMetadata(target, S.METADATA_KEYS[field], value);
	},

	async detachChannel(this: AppController, id: BufferID): Promise<void> {
		const buf = S.getBuffer(this.state, id);
		const client = buf ? this.clients.get(buf.server) : undefined;
		if (!buf || !client || buf.type !== BufferType.CHANNEL) {
			throw new Error("Not in a channel");
		}
		if (!client.isupport.bouncerNetID()) {
			throw new Error("Detaching channels requires the soju bouncer");
		}
		await client.sendServiceCommand(`channel update ${buf.name} -detached true`);
	},

	/** Whether Web Push can be enabled: supported by the browser and a server. */
	canEnablePush(this: AppController): boolean {
		if (!this.pushEnv) {
			return false;
		}
		for (const server of this.state.servers.values()) {
			if (server.features.webPush) {
				return true;
			}
		}
		return false;
	},

	/** Turn Web Push notifications on or off for all connections. */
	async setPushNotifications(this: AppController, enabled: boolean): Promise<void> {
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
	},

	/** Re-register the push subscription after connecting, servers may expire them. */
	async refreshPushRegistration(this: AppController, client: Client): Promise<void> {
		if (!this.pushEnv || !this.state.settings.pushNotifications || !client.supportsWebPush()) {
			return;
		}
		if (this.pushEnv.Notification.permission !== "granted") {
			return;
		}
		const subscription = await webpush.subscribe(this.pushEnv, client.isupport.vapid()!);
		await webpush.registerClient(client, subscription);
	},

	handleEndOfRegistration(this: AppController, serverID: number, client: Client): void {
		this.refreshPushRegistration(client).catch((err) => {
			console.warn("Failed to register for push notifications:", err);
		});

		// RPL_ENDOFMOTD and ERR_NOMOTD indicate the end of the ISUPPORT list

		if (this.state.servers.get(serverID)?.features.targetMetadata) {
			client.subscribeTargetMetadata(Object.values(S.METADATA_KEYS));
		}

		// Restore opened channel and user buffers
		let join: string[] = [];
		for (const buf of this.bufferStore.list(storeServer(client))) {
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

		joinChannels(client, join);

		const serverHost = bouncerNetwork?.host ?? "";
		if (this.autoOpenURL && serverHost === splitHostPort(this.autoOpenURL.host).host) {
			const url = this.autoOpenURL;
			this.autoOpenURL = null;

			// Roundtrip to ensure we've seen any server-initiated JOIN
			// messages sent right after connection registration
			client
				.ping()
				.then(() => this.openURL(url))
				.catch(() => {});
		} else if (this.initialRoute && (!this.initialRoute.host || serverHost === this.initialRoute.host)) {
			const route = this.initialRoute;
			if (route.host) {
				this.initialRoute = null;
			}

			client
				.ping()
				.then(() => {
					// Without a host, e.g. when opened from a push notification,
					// the buffer may be on any server: try again as the others
					// connect, until found
					if (!route.host && this.initialRoute !== route) {
						return;
					}
					if (this.openRoute(route)) {
						this.initialRoute = null;
					}
				})
				.catch(() => {});
		}
	},

	handleBouncerNetwork(this: AppController, serverID: number, client: Client, msg: Message): void {
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
			// soju.im/multiplex: the network shares this client's connection
			const multiplexer = client.caps.enabled.has(MULTIPLEX_CAP) ? client.getMultiplexer() : null;
			this.connect(
				{
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
				},
				multiplexer,
			);
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
				joinChannels(netClient, netClient.params.autojoin);
				netClient.params.autojoin = [];
			}
		}
	},

	handleMarkRead(this: AppController, serverID: number, client: Client, msg: Message): void {
		const target = msg.params[0];
		const bound = msg.params[1];
		if (!bound || bound === "*" || !bound.startsWith("timestamp=")) {
			return;
		}
		const readReceipt = { time: bound.replace("timestamp=", "") };
		const stored = this.bufferStore.get({ name: target, server: storeServer(client) });
		if (S.isReceiptBefore(readReceipt, getReceipt(stored, ReceiptType.READ))) {
			return;
		}
		this.closeNotifications(serverID, client, target, readReceipt);

		const buf = S.getBuffer(this.state, { server: serverID, name: target });
		let unread: Unread = Unread.NONE;
		if (buf) {
			// Re-compute unread status
			const server = this.state.servers.get(serverID);
			for (let i = buf.messages.length - 1; i >= 0 && unread !== Unread.HIGHLIGHT; i--) {
				const m = buf.messages[i];
				if (m.command !== "PRIVMSG" && m.command !== "NOTICE") {
					continue;
				}
				if (S.isMessageBeforeReceipt(m, readReceipt)) {
					break;
				}
				unread = S.unionUnread(unread, this.chatMessageUnread(client, server, buf.name, m));
			}
			this.setBufferState(buf.id, { unread });
		}

		this.bufferStore.put({
			name: target,
			server: storeServer(client),
			unread,
			closed: !buf,
			receipts: { [ReceiptType.READ]: readReceipt },
		});
		this.updateDocumentTitle();
	},

	findBouncerNetIDByHost(this: AppController, host: string): string | null {
		for (const [id, bouncerNetwork] of this.state.bouncerNetworks) {
			if (bouncerNetwork.host === host) {
				return id;
			}
		}
		return null;
	},

	/** Find the server of the bouncer network with the given host. */
	serverIDFromHost(this: AppController, host: string): number | null {
		const bouncerNetID = this.findBouncerNetIDByHost(host);
		if (!bouncerNetID) {
			return null;
		}
		for (const [id, server] of this.state.servers) {
			if (server.bouncerNetID === bouncerNetID) {
				return id;
			}
		}
		return null;
	},

	handleManageNetworkClick(this: AppController, serverID: number): void {
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
	},

	/** The connection to the bouncer itself, not bound to a network. */
	getBouncerClient(this: AppController): Client | undefined {
		for (const client of this.clients.values()) {
			if (!client.params.bouncerNetwork) {
				return client;
			}
		}
		return this.clients.values().next().value;
	},

	async handleNetworkSubmit(
		this: AppController,
		id: string | undefined,
		attrs: S.BouncerNetwork,
		autojoin: string | null,
	): Promise<void> {
		const client = this.getBouncerClient();
		if (!client) {
			return;
		}

		// Keep the dialog open until the bouncer accepted the change, so that
		// a rejected one can be fixed
		if (id) {
			if (Object.keys(attrs).length > 0) {
				try {
					await client.changeBouncerNetwork(id, attrs);
				} catch (err) {
					this.showError(err);
					return;
				}
			}
			this.dismissDialog();
		} else {
			let netID;
			try {
				netID = await client.createBouncerNetwork({ tls: "1", ...attrs });
			} catch (err) {
				this.showError(err);
				return;
			}
			this.dismissDialog();
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

			this.switchToChannel = { server: serverID, name: autojoin };
		}
	},

	async handleNetworkRemove(this: AppController, id: string): Promise<void> {
		const client = this.getBouncerClient();
		if (!client) {
			return;
		}
		try {
			await client.deleteBouncerNetwork(id);
		} catch (err) {
			this.showError(err);
			return;
		}
		this.dismissDialog();
	},
};

export type NetworkMethods = typeof networkMethods;
