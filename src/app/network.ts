/** Bouncer networks and soju metadata. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import { ClientStatus, MULTIPLEX_CAP } from "../lib/client";
import * as S from "../state";
import { SERVER_BUFFER, BufferType, type BufferID } from "../state";
import type AppController from "./controller";
import { joinChannels } from "./registration";

/** Connect to a new bouncer network, with the credentials of the bouncer connection. */
function connectBouncerNetwork(app: AppController, client: Client, id: string): void {
	// soju.im/multiplex: the network shares this client's connection
	const multiplexer = client.caps.enabled.has(MULTIPLEX_CAP) ? client.getMultiplexer() : null;
	app.connect(
		{
			...app.state.connectParams,
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

/** Join the channels waiting for a bouncer network to be connected. */
function joinPendingChannels(app: AppController, id: string): void {
	const netServerID = app.serverFromBouncerNetwork(id);
	const netClient = app.getClient(netServerID);
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

	/**
	 * Detach a channel on soju: the bouncer stays in it and keeps logging,
	 * but it's hidden from clients until joined again.
	 */
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
			connectBouncerNetwork(this, client, id);
		}

		if (attrs && attrs.state === "connected") {
			joinPendingChannels(this, id);
		}
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
