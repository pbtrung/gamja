/** Buffers: creating and switching them, and querying their details. */

import type Client from "../lib/client";
import { ClientStatus, type WhoxField } from "../lib/client";
import * as S from "../state";
import { BufferType, ReceiptType, type Buffer, type BufferID } from "../state";
import type AppController from "./controller";
import { getReceipt, storeServer } from "./history";

/** User details requested with WHO, see User in state.ts */
const WHO_FIELDS: WhoxField[] = ["flags", "hostname", "nick", "realname", "username", "account"];

/** Query the details of a buffer missing on a connected server: users, members. */
function fetchBufferDetails(app: AppController, buf: Buffer, client: Client): void {
	const server = app.state.servers.get(buf.server);
	if (buf.type === BufferType.NICK && !buf.hasInitialWho && server && !server.users.has(buf.name)) {
		app.whoUserBuffer(buf.name, buf.server);
	}

	if (buf.type === BufferType.CHANNEL && buf.joined && !buf.hasNames && client.hasNoImplicitNames()) {
		app.fetchNames(buf);
	}

	if (buf.type === BufferType.CHANNEL && !buf.hasInitialWho) {
		app.whoChannelBuffer(buf.name, buf.server).catch((err) => {
			console.warn(`Failed to WHO ${buf.name}:`, err);
		});
	}
}

export const buffersMethods = {
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
			this.previousBuffer = prevActive;
			// It may have been left scrolled up with older messages loaded
			this.trimBuffer(prevActive);
		}

		if (client && client.status === ClientStatus.REGISTERED) {
			fetchBufferDetails(this, buf, client);
			this.fetchDeferredBacklog(buf.id);
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
};

export type BuffersMethods = typeof buffersMethods;
