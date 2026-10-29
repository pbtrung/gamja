/** Connections: connecting to servers and bouncer networks, disconnecting. */

import * as irc from "../lib/irc";
import Client, { ClientStatus, IRCError, type MessageEventDetail, type Multiplexer } from "../lib/client";
import * as S from "../state";
import { SERVER_BUFFER, BufferEventsDisplayMode } from "../state";
import * as store from "../store";
import type { AppState, ConnectParams } from "./store";
import { resolveServerURL } from "./config";
import type AppController from "./controller";

function createClient(app: AppController, params: ConnectParams, multiplexer: Multiplexer | null): Client {
	const client = new Client({
		url: resolveServerURL(params.url, window.location),
		nick: params.nick || "",
		username: params.username || params.nick || "",
		realname: params.realname || params.nick || "",
		pass: params.pass,
		saslPlain: params.saslPlain,
		saslExternal: params.saslExternal,
		saslOauthBearer: params.saslOauthBearer,
		bouncerNetwork: params.bouncerNetwork,
		multiplexer,
		ping: params.ping,
		autojoin: [...params.autojoin],
		eventPlayback: app.state.settings.bufferEvents !== BufferEventsDisplayMode.HIDE,
	});
	client.debug = app.debug;
	client.present = app.present;
	client.awayMessage = app.state.awayMessage;
	return client;
}

/** Mark the channels of a disconnected server as left. */
function leaveServerChannels(state: AppState, serverID: number): Partial<AppState> {
	const buffers = new Map(state.buffers);
	state.buffers.forEach((buf) => {
		if (buf.server !== serverID) {
			return;
		}
		buffers.set(buf.id, { ...buf, ...S.leftChannel(buf) });
	});
	return { buffers };
}

/** Reflect the events of a client in the state of its server. */
function listenClient(app: AppController, serverID: number, client: Client): void {
	let errorID: number | null = null;

	client.addEventListener("status", () => {
		app.setServerState(serverID, { status: client.status });
		switch (client.status) {
			case ClientStatus.DISCONNECTED:
				// Features come back with the caps once registered again
				app.setServerState(serverID, { account: null, features: S.noFeatures });
				app.update((state) => leaveServerChannels(state, serverID));
				break;
			case ClientStatus.REGISTERED:
				app.update({ connectForm: false });
				if (errorID) {
					app.dismissError(errorID);
				}
				break;
		}
	});

	client.addEventListener("message", (event) => {
		app.handleMessage(serverID, (event as CustomEvent<MessageEventDetail>).detail.message);
	});

	client.addEventListener("reconnect", () => {
		app.setServerState(serverID, { reconnectAt: client.reconnectAt });
	});

	client.addEventListener("lag", () => {
		app.setServerState(serverID, { lag: client.lag });
	});

	client.addEventListener("error", (event) => {
		const err = (event as CustomEvent).detail;
		errorID = app.showError(err);
		const { saslPlain, saslExternal, saslOauthBearer } = client.params;
		if (
			saslOauthBearer &&
			!saslPlain &&
			!saslExternal &&
			err instanceof IRCError &&
			err.msg.command === irc.ERR_SASLFAIL
		) {
			app.handleOauth2TokenRejected(client);
		}
	});
}

export const connectionMethods = {
	/**
	 * Connect to a server, or to a bouncer network. A bouncer network is
	 * attached to the bouncer connection of the multiplexer if given, rather
	 * than getting its own connection (soju.im/multiplex).
	 */
	connect(
		this: AppController,
		params: Partial<ConnectParams>,
		multiplexer: Multiplexer | null = null,
	): number {
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

		const client = createClient(this, merged, multiplexer);

		this.clients.set(serverID, client);
		this.setServerState(serverID, { status: client.status });

		listenClient(this, serverID, client);

		this.createBuffer(serverID, SERVER_BUFFER);
		if (!this.state.activeBuffer) {
			this.switchBuffer({ server: serverID, name: SERVER_BUFFER });
		}

		if (merged.autojoin.length > 0) {
			this.switchToChannel = { server: serverID, name: merged.autojoin[0] };
		}

		return serverID;
	},

	disconnect(this: AppController, serverID?: number | null): void {
		if (!serverID) {
			serverID = S.getActiveServerID(this.state);
		}
		if (!serverID) {
			return;
		}

		// Keep the client around, so that the server can be reconnected
		this.clients.get(serverID)?.disconnect();
	},

	reconnect(this: AppController, serverID?: number | null): void {
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
	},

	handleConnectSubmit(this: AppController, connectParams: Partial<ConnectParams>): void {
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
	},
};

export type ConnectionMethods = typeof connectionMethods;
