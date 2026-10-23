/** Chat history: backlog on connect, missed and older messages, search. */

import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import type Client from "../lib/client";
import { ClientStatus, IRCError } from "../lib/client";
import * as S from "../state";
import { SERVER_BUFFER, BufferType, ReceiptType, type BufferID, type Receipt } from "../state";
import * as store from "../store";
import type AppController from "./controller";

const CHATHISTORY_MAX_SIZE = 4000;

/** How far ahead of ours the IRC server's clock may be, in milliseconds */
const MAX_CLOCK_SKEW = 24 * 60 * 60 * 1000;

/**
 * An upper bound for history queries which must include the latest messages.
 * Messages carry the IRC server's time: if its clock is ahead of ours, the
 * latest ones are in our future.
 */
function latestHistoryBound(): string {
	return irc.formatDate(new Date(Date.now() + MAX_CLOCK_SKEW));
}

/**
 * Fetch up to limit of the latest messages between two bounds, newest page
 * first: the server may send fewer messages per reply than asked for (its
 * CHATHISTORY limit). more is set if older messages may remain.
 */
async function fetchLatestBetween(
	client: Client,
	target: string,
	after: S.HistoryBound,
	before: S.HistoryBound,
	limit: number,
): Promise<{ messages: Message[]; more: boolean }> {
	let messages: Message[] = [];
	for (;;) {
		// The later bound goes first: CHATHISTORY BETWEEN then returns the
		// latest messages, newest page first. The spec allows bounds in either
		// order, and soju supports it.
		const page = await client.fetchHistoryPageBetween(target, before, after, limit - messages.length);
		messages = [...page.messages, ...messages];
		if (!page.more || page.messages.length === 0 || messages.length >= limit) {
			return { messages, more: page.more };
		}
		before = S.boundFromMessage(page.messages[0]);
	}
}

export function getReceipt(stored: store.StoredBuffer | undefined, type: ReceiptType): Receipt | null {
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

/** Changes gathered while handling a page of history, applied at once */
export interface HistoryBatch {
	/** Messages to add, by buffer ID */
	messages: Map<number, Message[]>;
	/** Last read marker update to send, by case-mapped buffer name */
	readMarkers: Map<string, store.BufferUpdate>;
}

export const historyMethods = {
	queueHistoryMessage(this: AppController, batch: HistoryBatch, bufID: BufferID, msg: Message): void {
		// Like addMessage(), skip buffers which don't exist (yet)
		const id = S.getBuffer(this.state, bufID)?.id;
		if (id === undefined) {
			return;
		}
		const messages = batch.messages.get(id);
		if (messages) {
			messages.push(msg);
		} else {
			batch.messages.set(id, [msg]);
		}
	},

	applyHistory(this: AppController, serverID: number, msgs: Message[], { live = false } = {}): void {
		const client = this.clients.get(serverID);
		if (!client) {
			return;
		}

		const batch: HistoryBatch = { messages: new Map(), readMarkers: new Map() };
		for (const msg of msgs) {
			if (msg.command === "TAGMSG") {
				this.handleTagMessage(serverID, msg);
				continue;
			}
			if (msg.command === "REDACT") {
				// Not displayed, but hides the message, even one loaded later.
				// Other state, e.g. members, isn't replayed from history.
				this.update((state) => S.handleRedact(state, msg, serverID, client));
				continue;
			}
			const destBuffers = this.routeMessage(serverID, msg);
			if (live) {
				for (const bufName of destBuffers) {
					this.handleChatMessage(serverID, bufName, msg, batch);
				}
				continue;
			}
			this.prepareChatMessage(serverID, msg);
			for (const bufName of destBuffers) {
				this.queueHistoryMessage(batch, { server: serverID, name: bufName }, msg);
			}
		}

		for (const [id, messages] of batch.messages) {
			this.update((state) => S.addMessages(state, messages, id));
		}
		for (const update of batch.readMarkers.values()) {
			this.sendReadReceipt(client, update);
		}
	},

	/** Open the search dialog for the active server. */
	openSearch(this: AppController, scope: "buffer" | "all" = "buffer", query?: string): void {
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
	},

	/** Search messages on a server. Results are sorted newest first. */
	async searchMessages(
		this: AppController,
		serverID: number,
		query: { text: string; in?: string | null; from?: string | null },
	): Promise<{ buffer: string; message: Message }[]> {
		const client = this.clients.get(serverID);
		if (!client) {
			throw new Error("Not connected to server");
		}
		const search = (target: string | undefined) =>
			client.search({
				text: query.text || undefined,
				in: target,
				from: query.from || undefined,
				limit: 100,
			});

		let messages: Message[];
		try {
			messages = await search(query.in || undefined);
		} catch (err) {
			// soju requires a target: search each buffer of the server instead
			const fail = err instanceof IRCError ? err.msg : null;
			const needsTarget = !query.in && fail?.command === "FAIL" && fail.params[2] === "in";
			if (!needsTarget) {
				throw err;
			}
			const targets = [...this.state.buffers.values()]
				.filter((buf) => buf.server === serverID && buf.type !== BufferType.SERVER)
				.map((buf) => buf.name);
			// One at a time: without labeled-response, concurrent batches of
			// the same type can't be told apart
			messages = [];
			for (const target of targets) {
				messages.push(...(await search(target)));
			}
		}
		return (
			messages
				.map((message) => ({ buffer: this.resolveMessageTarget(serverID, message), message }))
				// Newest first. Sorting is stable: results with the same time, e.g.
				// the lines of a multiline message, keep the server's order.
				.sort((a, b) => {
					const [ta, tb] = [a.message.tags.time ?? "", b.message.tags.time ?? ""];
					return ta === tb ? 0 : ta < tb ? 1 : -1;
				})
				.slice(0, 100)
		);
	},

	/** Open a buffer and scroll to a message, loading history around it if needed. */
	async jumpToMessage(
		this: AppController,
		serverID: number,
		target: string,
		msgid: string,
		time?: string,
	): Promise<void> {
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
			const messages = await client.fetchHistoryAround(target, { msgid, time }, 50);
			if (this.clients.get(serverID) !== client || !S.getBuffer(this.state, buf.id)) {
				return; // Closed meanwhile
			}
			this.applyHistory(serverID, messages);
		}
		this.update({ jumpTo: { buffer: buf.id, msgid } });
	},

	async fetchBacklog(this: AppController, serverID: number): Promise<void> {
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

		// The server may be closed while waiting for the history
		const isClosed = () => this.clients.get(serverID) !== client;
		// A disconnection fails the pending requests: not worth an error, the
		// backlog is fetched again once reconnected
		const isInterrupted = () => isClosed() || client.status !== ClientStatus.REGISTERED;

		const bound = latestHistoryBound();
		const targets = await client.fetchHistoryTargets(bound, lastReceipt.time);
		if (isClosed()) {
			return;
		}
		await Promise.all(
			targets.map(async (target) => {
				let from: S.HistoryBound = lastReceipt;
				const to = { time: bound };

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
					from = S.boundFromMessage(lastMsg);
				}

				// Query read marker if this is a user (ie, we haven't received
				// the read marker as part of a JOIN burst)
				if (client.supportsReadMarker() && client.isNick(target.name)) {
					client.fetchReadMarker(target.name);
				}

				// Only fetch the latest missed messages, as many as the
				// backlogSize setting: older ones are fetched on demand, see
				// fetchMissedMessages()
				let result;
				try {
					result = await fetchLatestBetween(
						client,
						target.name,
						from,
						to,
						S.backlogSize(this.state.settings),
					);
				} catch (err) {
					if (isInterrupted()) {
						return;
					}
					console.error("Failed to fetch backlog for '" + target.name + "': ", err);
					this.showError("Failed to fetch backlog for '" + target.name + "'");
					return;
				}
				if (isClosed()) {
					return;
				}

				if (result.more && result.messages.length > 0) {
					this.markMissedMessages(serverID, target.name, from, result.messages);
				}
				this.applyHistory(serverID, result.messages, { live: true });
			}),
		);
	},

	markMissedMessages(
		this: AppController,
		serverID: number,
		bufName: string,
		after: S.HistoryBound,
		page: Message[],
	): void {
		const buf = S.getBuffer(this.state, { server: serverID, name: bufName });
		if (!buf) {
			return;
		}
		if (buf.messages.length === 0) {
			if (buf.history === "end") {
				this.setBufferState(buf.id, { history: "more" });
			}
			return;
		}
		let oldest = page[0];
		for (const msg of page) {
			if (msg.tags.time! < oldest.tags.time!) {
				oldest = msg;
			}
		}
		// Missed messages of an earlier disconnection may not be fetched yet
		this.setBufferState(buf.id, (b) => ({
			gap: { after: b.gap?.after ?? after, before: S.boundFromMessage(oldest), status: "idle" },
		}));
	},

	/** Fetch the missed messages of a buffer which weren't fetched on reconnect. */
	async fetchMissedMessages(this: AppController, id: BufferID): Promise<void> {
		const buf = S.getBuffer(this.state, id);
		const client = buf ? this.clients.get(buf.server) : undefined;
		if (
			!buf?.gap ||
			buf.gap.status === "loading" ||
			!client ||
			client.status !== ClientStatus.REGISTERED
		) {
			return;
		}
		const { before } = buf.gap;
		let { after } = buf.gap;
		const setGap = (gap: S.HistoryGap | null) => this.setBufferState(buf.id, { gap });
		const isClosed = () => this.clients.get(buf.server) !== client || !S.getBuffer(this.state, buf.id);

		setGap({ after, before, status: "loading" });
		let total = 0;
		for (;;) {
			let result;
			try {
				result = await client.fetchHistoryPageBetween(
					buf.name,
					after,
					before,
					CHATHISTORY_MAX_SIZE - total,
				);
			} catch (err) {
				if (isClosed()) {
					return;
				}
				if (client.status !== ClientStatus.REGISTERED) {
					// Interrupted by a disconnection, not an error: the user can
					// try again once reconnected
					setGap({ after, before, status: "idle" });
					return;
				}
				setGap({ after, before, status: "error" });
				throw err;
			}
			if (isClosed()) {
				return;
			}
			// Already marked delivered: no notifications
			this.applyHistory(buf.server, result.messages);
			total += result.messages.length;
			if (!result.more) {
				break;
			}
			after = S.boundFromMessage(result.messages[result.messages.length - 1]);
			if (total >= CHATHISTORY_MAX_SIZE) {
				// Let the user ask for more
				setGap({ after, before, status: "idle" });
				return;
			}
			setGap({ after, before, status: "loading" });
		}

		setGap(null);
		if (this.state.activeBuffer === buf.id) {
			this.markBufferAsRead(buf.id);
		}
	},

	/** Load a page of older messages in the active buffer. */
	async fetchOlderMessages(this: AppController, retry = false): Promise<void> {
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
		if (client.isupport.chatHistory() === 0) {
			// soju doesn't advertise CHATHISTORY on the bouncer connection (e.g.
			// for BouncerServ), there is no history to load there. Elsewhere,
			// ISUPPORT may just not have arrived yet.
			const isBouncerConn =
				client.caps.enabled.has("soju.im/bouncer-networks") && !client.params.bouncerNetwork;
			if (isBouncerConn && buf.history !== "end") {
				this.setBufferState(buf.id, { history: "end" });
			}
			return;
		}
		if (buf.history === "loading" || buf.history === "end" || (buf.history === "error" && !retry)) {
			return;
		}

		const first = buf.messages[0];
		const before = {
			time: first?.tags.time ?? latestHistoryBound(),
			msgid: first?.tags.msgid ?? undefined,
		};

		// Avoids sending multiple CHATHISTORY commands in parallel
		this.setBufferState(buf.id, { history: "loading" });
		const isClosed = () => this.clients.get(buf.server) !== client || !S.getBuffer(this.state, buf.id);

		let limit = 100;
		if (client.caps.enabled.has("draft/event-playback")) {
			limit = 200;
		}

		let result;
		try {
			result = await client.fetchHistoryBefore(buf.name, before, limit);
		} catch (err) {
			if (isClosed()) {
				return;
			}
			if (client.status !== ClientStatus.REGISTERED) {
				// Interrupted by a disconnection, not an error: fetch again
				// once reconnected
				this.setBufferState(buf.id, { history: buf.history });
				return;
			}
			// Don't retry automatically, the user can retry from the UI
			this.setBufferState(buf.id, { history: "error" });
			throw err;
		}
		if (isClosed()) {
			return;
		}
		this.setBufferState(buf.id, { history: result.more ? "more" : "end" });

		if (result.messages.length > 0) {
			const msg = result.messages[result.messages.length - 1];
			const receipts: store.Receipts = { [ReceiptType.DELIVERED]: S.receiptFromMessage(msg) };
			if (this.state.activeBuffer === buf.id) {
				receipts[ReceiptType.READ] = S.receiptFromMessage(msg);
			}
			this.storeReceipts(client, { name: buf.name, server: client.params, receipts });
			this.setBufferState(buf.id, ({ prevReadReceipt }) => {
				if (!S.isMessageBeforeReceipt(msg, prevReadReceipt)) {
					prevReadReceipt = S.receiptFromMessage(msg);
				}
				return { prevReadReceipt };
			});
		}

		this.applyHistory(buf.server, result.messages);
	},
};

export type HistoryMethods = typeof historyMethods;
