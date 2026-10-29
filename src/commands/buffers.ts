/** Commands switching between buffers and organizing them. */

import { SERVER_BUFFER, BufferType, getBuffer, type TargetMetadata } from "../state";
import { getActiveBuffer, requireArg, type Command } from "./common";

/** /pin, /mute, /block and their opposites (soju metadata) */
export function metadataCommand(
	name: string,
	field: keyof TargetMetadata,
	value: boolean,
	usage: string,
	description: string,
): Command {
	return {
		name,
		usage,
		description,
		execute: (app, args) => {
			const buf = getActiveBuffer(app);
			// Blocking needs a nick, the others default to the current buffer
			const target = field === "blocked" ? requireArg(args, 0, "nick") : (args[0] ?? buf.name);
			if (target === SERVER_BUFFER) {
				throw new Error("Not in a channel or conversation");
			}
			app.setTargetMetadata(buf.server, target, field, value);
		},
	};
}

export const buffer: Command = {
	name: "buffer",
	usage: "<name>",
	description: "Switch to a buffer",
	execute: (app, args) => {
		const name = requireArg(args, 0, "buffer name");
		// Prefer the active server, then look for it on the others
		const buf = app.findBufferOnAnyServer(name);
		if (!buf) {
			throw new Error("Unknown buffer");
		}
		app.switchBuffer(buf.id);
	},
};

export const close: Command = {
	name: "close",
	description: "Close the current buffer",
	execute: (app) => {
		const activeBuffer = getBuffer(app.state, app.state.activeBuffer);
		if (!activeBuffer || activeBuffer.type === BufferType.SERVER) {
			throw new Error("Not in a user or channel buffer");
		}
		app.close(activeBuffer.id);
	},
};

export const help: Command = {
	name: "help",
	description: "Show help menu",
	execute: (app) => {
		app.openHelp();
	},
};

export const search: Command = {
	name: "search",
	usage: "[text]",
	description: "Search messages in the current buffer",
	execute: (app, _args, text) => {
		app.openSearch("buffer", text || undefined);
	},
};

export const pin = metadataCommand(
	"pin",
	"pinned",
	true,
	"[target]",
	"Pin a buffer to the top of the list (soju)",
);
export const unpin = metadataCommand("unpin", "pinned", false, "[target]", "Unpin a buffer (soju)");
export const mute = metadataCommand(
	"mute",
	"muted",
	true,
	"[target]",
	"Silence a buffer's notifications (soju)",
);
export const unmute = metadataCommand(
	"unmute",
	"muted",
	false,
	"[target]",
	"Restore a buffer's notifications (soju)",
);
export const block = metadataCommand("block", "blocked", true, "<nick>", "Hide messages from a user (soju)");
export const unblock = metadataCommand(
	"unblock",
	"blocked",
	false,
	"<nick>",
	"Show messages from a blocked user again (soju)",
);
