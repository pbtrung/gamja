/** Recording and filling gaps left between loaded history pages. */
import type { Message } from "../../lib/irc";
import { ClientStatus } from "../../lib/client";
import * as S from "../../state";
import type { BufferID } from "../../state";
import type AppController from "../controller";

export const gapMethods = {
	/**
	 * Record that missed messages weren't all fetched: those between the
	 * last loaded message and the oldest of the fetched page. Without loaded
	 * messages, they are fetched as older history instead.
	 */
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
		let { before } = buf.gap;
		const { after } = buf.gap;
		const setGap = (gap: S.HistoryGap | null) => this.setBufferState(buf.id, { gap });
		const isClosed = () => this.clients.get(buf.server) !== client || !S.getBuffer(this.state, buf.id);

		const capacity = S.historyLimit(this.state.settings) - buf.messages.length;
		if (capacity <= 0) {
			if (buf.history !== "limited") {
				this.setBufferState(buf.id, { history: "limited" });
			}
			return;
		}
		const limit = Math.min(S.backlogSize(this.state.settings), capacity);
		setGap({ after, before, status: "loading" });
		let total = 0;
		for (;;) {
			let result;
			try {
				result = await client.fetchHistoryPageBetween(buf.name, before, after, limit - total);
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
			if (!result.more || result.messages.length === 0) {
				break;
			}
			const next = S.boundFromMessage(result.messages[0]);
			if (next.time === before.time && next.msgid === before.msgid) {
				setGap({ after, before, status: "error" });
				throw new Error("History pagination did not advance");
			}
			before = next;
			if (total >= limit) {
				// Let the user ask for more
				setGap({ after, before, status: "idle" });
				if (S.getBuffer(this.state, buf.id)!.messages.length >= S.historyLimit(this.state.settings)) {
					this.setBufferState(buf.id, { history: "limited" });
				}
				return;
			}
			setGap({ after, before, status: "loading" });
		}

		setGap(null);
		if (this.state.activeBuffer === buf.id) {
			this.markBufferAsRead(buf.id);
		}
	},
};
