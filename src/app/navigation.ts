/** Navigation: opening buffers from targets, URLs and routes, and closing them. */

import * as irc from "../lib/irc";
import type Client from "../lib/client";
import { ClientStatus } from "../lib/client";
import * as S from "../state";
import { SERVER_BUFFER, BufferType, type Buffer, type BufferID } from "../state";
import * as store from "../store";
import type { AppState } from "./store";
import { splitHostPort } from "./config";
import type AppController from "./controller";
import { storeServer } from "./history";

/** Join a channel and switch to it once joined. */
function openChannel(
	app: AppController,
	client: Client,
	serverID: number,
	target: string,
	password?: string,
): void {
	const buf = S.getBuffer(app.state, { server: serverID, name: target });
	if (buf?.joined) {
		app.switchBuffer(buf.id);
		return;
	}
	const switchTo = { server: serverID, name: target };
	app.switchToChannel = switchTo;
	client
		.join(target, password)
		.then((joined) => {
			// Forwarded to another channel (ERR_LINKCHANNEL): its JOIN
			// didn't match, switch to it now
			if (app.switchToChannel === switchTo) {
				app.switchToChannel = null;
				app.switchBuffer({ server: serverID, name: joined });
			}
		})
		.catch((err) => {
			app.showError(err);
		});
}

/**
 * Open the dialog to create a bouncer network for an irc:// URL with an
 * unknown host. Returns false if the server isn't a bouncer.
 */
function openNewNetworkDialog(
	app: AppController,
	host: string,
	port: number | null,
	entity: string,
): boolean {
	const client = app.clients.values().next().value;
	if (!client || !client.caps.enabled.has("soju.im/bouncer-networks")) {
		return false;
	}

	const params: S.BouncerNetwork = { host };
	if (typeof port === "number") {
		params.port = String(port);
	}
	app.openDialog({ kind: "network", params, autojoin: entity });
	return true;
}

/** The first server not bound to a bouncer network. */
function getRootServerID(state: AppState): number | undefined {
	for (const [id, server] of state.servers) {
		if (!server.bouncerNetID) {
			return id;
		}
	}
	return undefined;
}

/**
 * Remove the buffers of a server. If one of them is active, switch to the
 * first remaining buffer.
 */
function removeServerBuffers(state: AppState, serverID: number): Partial<AppState> {
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
}

/** Remove a server, showing the connect form if it was the last one. */
function removeServer(state: AppState, serverID: number): Partial<AppState> {
	const servers = new Map(state.servers);
	servers.delete(serverID);

	let connectForm = state.connectForm;
	if (servers.size === 0) {
		connectForm = true;
	}

	return { servers, connectForm };
}

export const navigationMethods = {
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
			openChannel(this, client, serverID, target, password);
		} else {
			this.createBuffer(serverID, target);
			this.whoUserBuffer(target, serverID);
			this.switchBuffer({ server: serverID, name: target });
		}
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
				return openNewNetworkDialog(this, host, port, url.entity);
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
			buf =
				S.getBuffer(this.state, { server: getRootServerID(this.state), name: entity }) ??
				this.findBufferOnAnyServer(entity);
		}

		if (!buf) {
			console.error(`No buffer found with entity "${entity || "<none>"}"`);
			return false;
		}
		this.switchBuffer(buf.id);
		return true;
	},

	/**
	 * Find a buffer by name when its server isn't known: on the active server
	 * first, otherwise the one with the most important unread state.
	 */
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
		this.update((state) => removeServerBuffers(state, serverID));

		// From the server state rather than the caps, which are gone
		// while disconnected
		const disconnectAll =
			client && !client.params.bouncerNetwork && Boolean(this.state.servers.get(serverID)?.isBouncer);
		const isFirstServer = this.state.servers.keys().next().value === serverID;

		this.disconnect(serverID);
		this.clients.delete(serverID);

		this.update((state) => removeServer(state, serverID));

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
};

export type NavigationMethods = typeof navigationMethods;
