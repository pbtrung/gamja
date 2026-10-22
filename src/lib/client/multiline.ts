/** draft/multiline: assembling received batches, expanding sent text. */

import * as irc from "../irc";
import type { Message, OutgoingMessage } from "../irc";

/** draft/multiline batches being received: their BATCH command and lines */
export type MultilineBatches = Map<string, { opener: Message; lines: Message[] }>;

/**
 * Assemble a draft/multiline batch into a single PRIVMSG or NOTICE whose
 * text contains line breaks. Returns null while the batch is incomplete,
 * and the message itself if it isn't part of such a batch.
 */
export function assembleMultiline(batches: MultilineBatches, msg: Message): Message | null {
	if (msg.command === "BATCH") {
		const { start, name } = irc.parseBatchRef(msg);
		if (start && msg.params[1] === irc.MULTILINE_BATCH_TYPE) {
			batches.set(name, { opener: msg, lines: [] });
			return null;
		}
		const batch = start ? undefined : batches.get(name);
		if (!batch) {
			return msg;
		}
		batches.delete(name);
		const joined = irc.joinMultiline(batch.opener, batch.lines);
		if (!joined) {
			console.error("Ignoring invalid multiline batch:", name);
		}
		return joined;
	}
	const batch = batches.get(msg.tags.batch ?? "");
	if (batch) {
		batch.lines.push(msg);
		return null;
	}
	return msg;
}

export interface ExpandContext {
	isupport: irc.Isupport;
	/** Our nick, for the length of the prefix the server adds */
	nick: string;
	supportsMultiline: boolean;
	/** A new batch reference */
	nextBatchRef: () => string;
}

/**
 * Expand a PRIVMSG or NOTICE whose text contains line breaks into a
 * draft/multiline batch, or into one message per line if the server
 * doesn't support it.
 */
export function expandMultiline(msg: OutgoingMessage, ctx: ExpandContext): OutgoingMessage[] {
	const params = msg.params ?? [];
	const text = params[1];
	if (
		(msg.command !== "PRIVMSG" && msg.command !== "NOTICE") ||
		typeof text !== "string" ||
		!text.includes("\n")
	) {
		return [msg];
	}
	const target = String(params[0]);
	const maxLen = irc.getMaxPrivmsgLen(ctx.isupport, ctx.nick, target);
	const lines = irc.splitMultiline(text, maxLen);
	if (ctx.supportsMultiline) {
		const ref = ctx.nextBatchRef();
		return [
			{ tags: msg.tags, command: "BATCH", params: ["+" + ref, irc.MULTILINE_BATCH_TYPE, target] },
			...lines.map((line) => {
				const tags: irc.Tags = { batch: ref };
				if (line.concat) {
					tags[irc.MULTILINE_CONCAT_TAG] = null;
				}
				return { tags, command: msg.command, params: [target, line.text] };
			}),
			{ command: "BATCH", params: ["-" + ref] },
		];
	}
	// Only the first message carries the label
	const { label: _label, ...otherTags } = msg.tags ?? {};
	return lines
		.filter((line) => line.text !== "")
		.map((line, i) => ({
			...msg,
			tags: i === 0 ? msg.tags : otherTags,
			params: [target, line.text],
		}));
}
