/** What commands are made of, and the helpers they share. */

import { ClientStatus } from "../lib/client";
import type Client from "../lib/client";
import { BufferType, Unread, getBuffer, unionUnread } from "../state";
import type AppController from "../app/controller";

export interface Command {
	name: string;
	usage?: string;
	description: string;
	/**
	 * Arguments are split on spaces, text is the raw string they come from,
	 * for commands taking text which may contain repeated spaces. Returns
	 * false when the command failed and the error was already shown.
	 */
	execute: (app: AppController, args: string[], text: string) => void | boolean | Promise<void>;
}

/** The raw text after the first n arguments, keeping its spaces. */
export function textAfter(text: string, n: number): string {
	for (let i = 0; i < n; i++) {
		text = text.replace(/^[^ ]* */, "");
	}
	return text;
}

/**
 * The client of the active server, once registered: before, servers reject
 * most commands. Raw commands can be sent while registering.
 */
export function getActiveClient(app: AppController, { registering = false } = {}): Client {
	const client = app.getActiveClient();
	const ready =
		client?.status === ClientStatus.REGISTERED ||
		(registering && client?.status === ClientStatus.REGISTERING);
	if (!client || !ready) {
		throw new Error("Not connected to the server");
	}
	return client;
}

export function getActiveBuffer(app: AppController) {
	const buf = getBuffer(app.state, app.state.activeBuffer);
	if (!buf) {
		throw new Error("Not in a buffer");
	}
	return buf;
}

export function getActiveTarget(app: AppController): string {
	return getActiveBuffer(app).name;
}

export function getActiveChannel(app: AppController): string {
	const buf = getBuffer(app.state, app.state.activeBuffer);
	if (!buf || buf.type !== BufferType.CHANNEL) {
		throw new Error("Not in a channel");
	}
	return buf.name;
}

export function requireArg(args: string[], i: number, what: string): string {
	const v = args[i];
	if (!v) {
		throw new Error("Missing " + what);
	}
	return v;
}

export function markServerBufferUnread(app: AppController): void {
	const activeBuffer = getBuffer(app.state, app.state.activeBuffer);
	if (!activeBuffer || activeBuffer.type === BufferType.SERVER) {
		return;
	}
	app.setBufferState({ server: activeBuffer.server }, (buf) => {
		return { unread: unionUnread(buf.unread, Unread.MESSAGE) };
	});
}
