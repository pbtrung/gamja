/** Message search, and jumping to a message. */

import type { Message } from "../lib/irc";
import { IRCError } from "../lib/client";
import * as S from "../state";
import { BufferType } from "../state";
import type AppController from "./controller";

interface SearchResult {
	buffer: string;
	message: Message;
}

/**
 * Newest first. Sorting is stable: results with the same time, e.g. the
 * lines of a multiline message, keep the server's order.
 */
function compareNewestFirst(a: SearchResult, b: SearchResult): number {
	const [ta, tb] = [a.message.tags.time ?? "", b.message.tags.time ?? ""];
	return ta === tb ? 0 : ta < tb ? 1 : -1;
}

export const searchMethods = {
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
	): Promise<SearchResult[]> {
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
		return messages
			.map((message) => ({ buffer: this.resolveMessageTarget(serverID, message), message }))
			.sort(compareNewestFirst)
			.slice(0, 100);
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
};

export type SearchMethods = typeof searchMethods;
