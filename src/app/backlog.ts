/** Backlog orchestration: discover targets and load their missed messages. */
import type Client from "../lib/client";
import { ClientStatus } from "../lib/client";
import * as S from "../state";
import { ReceiptType } from "../state";
import type AppController from "./controller";
import { latestHistoryBound, storeServer } from "./history";
import { backlogStart, fetchLatestBetween, getLatestReceipt, type DeferredBacklog } from "./backlog/bounds";
import { unreadMethods } from "./backlog/unread";
import { gapMethods } from "./backlog/gaps";
export type { DeferredBacklog } from "./backlog/bounds";

/** The lower bound of CHATHISTORY TARGETS listing every target */
const HISTORY_START = "1970-01-01T00:00:00.000Z";

export const backlogMethods = {
	...unreadMethods,
	...gapMethods,
	/**
	 * Show which buffers have missed messages and mentions, without loading
	 * them: only the active buffer's are loaded, the others' once opened.
	 * With soju.im/unread, the server tells which targets have unread
	 * messages and mentions after their read marker; otherwise targets with
	 * messages after ours are unread, and private ones mention us. Without
	 * it, private targets without a buffer are loaded, to route them.
	 */
	async fetchBacklog(this: AppController, serverID: number): Promise<void> {
		const client = this.clients.get(serverID)!;
		if (!client.caps.enabled.has("draft/chathistory")) {
			return;
		}
		if (client.caps.enabled.has("soju.im/bouncer-networks") && !client.params.bouncerNetwork) {
			return;
		}

		const serverState = client.caps.enabled.has("soju.im/unread");
		const lastReceipt = getLatestReceipt(this.bufferStore, storeServer(client), ReceiptType.DELIVERED);
		if (!lastReceipt && !serverState) {
			return;
		}

		const bound = latestHistoryBound();
		// The server's state covers every target, read elsewhere or not
		const targets = await client.fetchHistoryTargets(
			bound,
			serverState ? HISTORY_START : lastReceipt!.time,
		);
		// The server may be closed while waiting for the history
		if (this.clients.get(serverID) !== client) {
			return;
		}
		await Promise.all(
			targets.map(async (target) => {
				// Query read marker if this is a user (ie, we haven't received
				// the read marker as part of a JOIN burst)
				if (client.supportsReadMarker() && client.isNick(target.name)) {
					client.fetchReadMarker(target.name);
				}

				const unread = this.targetUnread(serverID, client, target, serverState);
				let buf = S.getBuffer(this.state, { server: serverID, name: target.name });
				if (!buf && !client.isChannel(target.name)) {
					if (!serverState) {
						// Only the messages tell whether it's a conversation:
						// notices (e.g. from services) go to the server buffer
						const from = backlogStart(this, serverID, client, target.name, lastReceipt!);
						await this.fetchTargetBacklog(serverID, client, target.name, {
							from,
							to: { time: bound },
						});
						return;
					}
					// The server only counts private PRIVMSGs as mentions
					if (target.mention) {
						this.createBuffer(serverID, target.name);
						buf = S.getBuffer(this.state, { server: serverID, name: target.name });
					}
				}
				if (!buf) {
					return;
				}
				if (serverState) {
					this.applyUnreadSnapshot(buf.id, client, target, unread);
				}

				// Without loaded messages, opening the buffer loads its
				// latest ones anyway
				const lastMsg = buf.messages.at(-1);
				const from = lastReceipt
					? backlogStart(this, serverID, client, target.name, lastReceipt)
					: lastMsg && S.boundFromMessage(lastMsg);
				const backlog = from && { from, to: { time: bound } };
				if (buf.id === this.state.activeBuffer) {
					if (backlog) {
						await this.fetchTargetBacklog(serverID, client, target.name, backlog);
					}
					return;
				}
				if (backlog) {
					const prev = this.deferredBacklogs.get(buf.id);
					// Missed messages of an earlier disconnection aren't fetched yet
					this.deferredBacklogs.set(buf.id, prev ? { from: prev.from, to: backlog.to } : backlog);
				}
				if (!serverState) {
					this.markBufferUnread(buf.id, client, unread);
				}
			}),
		);
	},

	/**
	 * Fetch the latest missed messages of a target, as many as the
	 * backlogSize setting: older ones are fetched on demand, see
	 * fetchMissedMessages().
	 */
	async fetchTargetBacklog(
		this: AppController,
		serverID: number,
		client: Client,
		target: string,
		{ from, to }: DeferredBacklog,
	): Promise<void> {
		const buf = S.getBuffer(this.state, { server: serverID, name: target });
		// The server may be closed while waiting for the history
		const isClosed = () =>
			this.clients.get(serverID) !== client || (!!buf && !S.getBuffer(this.state, buf.id));
		// A disconnection fails the pending requests: not worth an error, the
		// backlog is fetched again once reconnected
		const isInterrupted = () => isClosed() || client.status !== ClientStatus.REGISTERED;
		if (buf && this.loadingBacklogs.has(buf.id)) {
			return;
		}
		// An initial BEFORE query already loads the latest messages. If it is
		// loading older history instead, retain this backlog until it finishes.
		if (buf?.history === "loading") {
			if (buf.messages.length > 0) {
				this.deferredBacklogs.set(buf.id, { from, to });
			}
			return;
		}
		const capacity = buf
			? S.historyLimit(this.state.settings) - buf.messages.length
			: S.backlogSize(this.state.settings);
		if (capacity <= 0 && buf) {
			this.deferredBacklogs.set(buf.id, { from, to });
			this.setBufferState(buf.id, { history: "limited" });
			return;
		}
		if (buf) {
			this.loadingBacklogs.add(buf.id);
		}

		let result;
		try {
			result = await fetchLatestBetween(
				client,
				target,
				from,
				to,
				Math.min(S.backlogSize(this.state.settings), capacity),
			);
		} catch (err) {
			if (buf && !isClosed()) {
				// Retain the original lower bound until the request succeeds.
				const pending = this.deferredBacklogs.get(buf.id);
				this.deferredBacklogs.set(buf.id, { from, to: pending?.to ?? to });
			}
			if (isInterrupted()) {
				return;
			}
			console.error("Failed to fetch backlog for '" + target + "': ", err);
			this.showError("Failed to fetch backlog for '" + target + "'");
			return;
		} finally {
			if (buf) {
				this.loadingBacklogs.delete(buf.id);
			}
		}
		if (isClosed()) {
			return;
		}

		if (result.more && result.messages.length > 0) {
			this.markMissedMessages(serverID, target, from, result.messages);
		} else if (!result.more && buf) {
			this.setBufferState(buf.id, (b) => ({
				unreadLoadedSince:
					b.unreadLoadedSince && b.unreadLoadedSince < from.time ? b.unreadLoadedSince : from.time,
			}));
		}
		this.applyHistory(serverID, result.messages, { live: true });
	},

	/** Fetch the missed messages left for when the buffer is opened. */
	fetchDeferredBacklog(this: AppController, id: number): void {
		const backlog = this.deferredBacklogs.get(id);
		const buf = S.getBuffer(this.state, id);
		const client = buf ? this.clients.get(buf.server) : undefined;
		if (!backlog || !buf || !client || client.status !== ClientStatus.REGISTERED) {
			return;
		}
		this.deferredBacklogs.delete(id);
		this.fetchTargetBacklog(buf.server, client, buf.name, backlog).catch((err) => {
			console.error("Failed to fetch backlog for '" + buf.name + "': ", err);
		});
	},
};

export type BacklogMethods = typeof backlogMethods;
