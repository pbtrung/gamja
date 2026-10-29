import * as irc from "../../lib/irc";
import type Client from "../../lib/client";
import { BufferType, Unread, unionUnread, type Buffer } from "../../state";
import type { AppState } from "../../app/store";

/** The most important unread state of the buffers other than the active one */
export function getUnreadElsewhere(state: AppState, activeBuffer: Buffer | null): Unread {
	let unreadElsewhere: Unread = Unread.NONE;
	for (const buf of state.buffers.values()) {
		if (buf.id !== activeBuffer?.id) {
			unreadElsewhere = unionUnread(unreadElsewhere, buf.unread);
		}
	}
	return unreadElsewhere;
}

export interface ComposerLimits {
	commandOnly: boolean;
	maxLen?: number;
	multiline: irc.MultilineLimits | null;
}

/** What may be typed in the composer of the active buffer */
export function getComposerLimits(activeBuffer: Buffer | null, activeClient: Client | null): ComposerLimits {
	if (activeBuffer?.type === BufferType.SERVER) {
		return { commandOnly: true, multiline: null };
	}
	if (activeBuffer && activeClient?.nick) {
		return {
			commandOnly: false,
			maxLen: irc.getMaxPrivmsgLen(activeClient.isupport, activeClient.nick, activeBuffer.name),
			multiline: activeClient.multilineLimits(),
		};
	}
	return { commandOnly: false, multiline: null };
}
