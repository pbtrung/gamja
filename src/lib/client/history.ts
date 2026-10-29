/** Batched replies: chat history (CHATHISTORY) and server-side search. */

import * as irc from "../irc";
import type { Message, OutgoingMessage } from "../irc";
import { QueryClient } from "./queries";
import type { BatchResult, ChatHistoryTarget } from "./types";

/** A CHATHISTORY bound, by message ID and/or timestamp */
type HistoryBound = { msgid?: string; time?: string };

/** A page of history, with whether there may be more */
type HistoryPage = { messages: Message[]; more: boolean };

export abstract class HistoryClient extends QueryClient {
	fetchBatch(msg: OutgoingMessage, batchType: string | string[]): Promise<BatchResult> {
		const batchTypes = Array.isArray(batchType) ? batchType : [batchType];
		let batchName: string | null = null;
		const messages: Message[] = [];
		return this.roundtrip(msg, (msg) => {
			for (const batch of batchName ? irc.batchAncestry(msg) : []) {
				if (batch.name === batchName) {
					messages.push(msg);
					break;
				}
			}

			if (msg.command !== "BATCH") {
				return;
			}

			const { start, name } = irc.parseBatchRef(msg);
			if (start && batchTypes.includes(msg.params[1])) {
				batchName = name;
				return;
			}
			if (!start && name === batchName) {
				return { ...this.batches.get(name)!, messages };
			}
		});
	}

	roundtripChatHistory(params: (string | number)[], batchType = "chathistory"): Promise<Message[]> {
		// Don't send multiple CHATHISTORY commands in parallel, we can't
		// properly handle batches and errors.
		const promise = this.pendingCmds.CHATHISTORY.then(async () => {
			const msg = {
				command: "CHATHISTORY",
				params,
			};
			const batch = await this.fetchBatch(msg, batchType);
			return batch.messages;
		});
		this.pendingCmds.CHATHISTORY = promise.catch(() => {});
		return promise;
	}

	/**
	 * A CHATHISTORY bound. Bounds are exclusive: use the message's ID if the
	 * server accepts it, its timestamp would skip the messages sharing it.
	 * soju only accepts timestamps (MSGREFTYPES=timestamp).
	 */
	msgRef(bound: HistoryBound): string {
		if (bound.msgid && (!bound.time || this.isupport.msgRefTypes().includes("msgid"))) {
			return "msgid=" + bound.msgid;
		}
		return "timestamp=" + bound.time;
	}

	/** Fetch a page of at most `max` messages, `max` being the last param. */
	async fetchHistoryPage(params: (string | number)[], max: number): Promise<HistoryPage> {
		const messages = await this.roundtripChatHistory([...params, max]);
		return { messages, more: max > 0 && messages.length >= max };
	}

	/* Fetch one page of history before the given date. */
	async fetchHistoryBefore(
		target: string,
		before: { time: string; msgid?: string },
		limit: number,
	): Promise<HistoryPage> {
		const max = Math.min(limit, this.isupport.chatHistory());
		return this.fetchHistoryPage(["BEFORE", target, this.msgRef(before)], max);
	}

	/**
	 * Fetch one page of history between two bounds, in ascending order. With
	 * the later bound first, the page holds the latest messages.
	 */
	async fetchHistoryPageBetween(
		target: string,
		from: { time: string; msgid?: string },
		to: { time: string; msgid?: string },
		limit: number,
	): Promise<HistoryPage> {
		const max = Math.min(limit, this.isupport.chatHistory());
		return this.fetchHistoryPage(["BETWEEN", target, this.msgRef(from), this.msgRef(to)], max);
	}

	/* Fetch messages around a message ID or timestamp. */
	async fetchHistoryAround(target: string, bound: HistoryBound, limit: number): Promise<Message[]> {
		const max = Math.min(limit, this.isupport.chatHistory());
		return this.roundtripChatHistory(["AROUND", target, this.msgRef(bound), max]);
	}

	async fetchHistoryTargets(t1: string, t2: string): Promise<ChatHistoryTarget[]> {
		const messages = await this.roundtripChatHistory(
			["TARGETS", "timestamp=" + t1, "timestamp=" + t2, 1000],
			"draft/chathistory-targets",
		);
		return messages.map((msg) => {
			console.assert(msg.command === "CHATHISTORY" && msg.params[0] === "TARGETS");
			return {
				name: msg.params[1],
				latestMessage: msg.params[2],
			};
		});
	}

	/** Run a server-side message search (soju.im/search). */
	async search(query: {
		text?: string;
		in?: string;
		from?: string;
		before?: string;
		after?: string;
		limit?: number;
	}): Promise<Message[]> {
		const attrs: irc.Tags = {};
		for (const [k, v] of Object.entries(query)) {
			if (v !== undefined && v !== null && v !== "") {
				attrs[k] = String(v);
			}
		}
		const msg = { command: "SEARCH", params: [irc.formatTags(attrs)] };
		const batch = await this.fetchBatch(msg, ["soju.im/search", "search"]);
		return batch.messages;
	}
}
