/** The browser window: title, hash routes, focus, visibility and presence. */

import { ClientStatus } from "../lib/client";
import * as S from "../state";
import { BufferType, Unread } from "../state";
import { formatWindowHash, parseWindowHash } from "./config";
import type AppController from "./controller";

export const windowMethods = {
	updateDocumentTitle(this: AppController): void {
		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		const server = buf ? this.state.servers.get(buf.server) : undefined;
		const bouncerNetwork = buf ? this.getBouncerNetwork(buf.server) : null;

		let numUnread = 0;
		for (const buffer of this.state.buffers.values()) {
			if (S.compareUnread(buffer.unread, Unread.HIGHLIGHT) >= 0) {
				numUnread++;
			}
		}

		const parts: string[] = [];
		if (buf && buf.type !== BufferType.SERVER) {
			parts.push(buf.name);
		}
		if (server && bouncerNetwork) {
			parts.push(S.getServerName(server, bouncerNetwork));
		}
		parts.push(this.baseTitle);

		let title = "";
		if (numUnread > 0) {
			title = `(${numUnread}) `;
		}
		title += parts.join(" · ");

		document.title = title;
	},

	computeWindowHash(this: AppController): string {
		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		const bouncerNetwork = buf ? this.getBouncerNetwork(buf.server) : null;
		const host = bouncerNetwork?.host;
		if (!buf) {
			return formatWindowHash(host, null);
		}
		return formatWindowHash(host, buf.type === BufferType.SERVER ? null : buf.name);
	},

	/** The chat log scrolled to its latest messages, or away from them. */
	handleScrolledToLatest(this: AppController, atLatest: boolean): void {
		this.scrolledToLatest = atLatest;
		const id = this.state.activeBuffer;
		if (atLatest && id !== null) {
			// Older messages loaded while scrolled up can go now
			this.trimBuffer(id);
			if (this.isBufferVisible(id)) {
				this.markBufferAsRead(id);
			}
		}
	},

	updateWindowHash(this: AppController): void {
		const hash = this.computeWindowHash();
		if (window.location.hash !== hash) {
			window.history.replaceState(null, "", hash);
		}
	},

	handleWindowFocus(this: AppController): void {
		if (this.state.activeBuffer && this.scrolledToLatest) {
			this.markBufferAsRead(this.state.activeBuffer);
		}

		// When the user focuses gamja, send a PING to make sure we detect any
		// network errors ASAP

		const now = new Date();
		if (this.lastFocusPingDate && now.getTime() - this.lastFocusPingDate.getTime() < 15 * 1000) {
			return;
		}
		this.lastFocusPingDate = now;

		for (const client of this.clients.values()) {
			if (client.status === ClientStatus.REGISTERED) {
				client.send({ command: "PING", params: ["gamja"] });
			}
		}
	},

	handleWindowHashChange(this: AppController): void {
		if (window.location.hash === this.computeWindowHash()) {
			return;
		}

		// The user navigated, a pending route is stale
		this.initialRoute = null;
		this.openRoute(parseWindowHash(window.location.hash));
	},

	/** Install window event listeners. Returns a cleanup function. */
	attach(this: AppController): () => void {
		const onFocus = () => this.handleWindowFocus();
		const onHashChange = () => this.handleWindowHashChange();
		const onWorkerMessage = (event: MessageEvent) => this.handleWorkerMessage(event.data);
		const onVisibilityChange = () => this.handleVisibilityChange();
		window.addEventListener("focus", onFocus);
		window.addEventListener("hashchange", onHashChange);
		document.addEventListener("visibilitychange", onVisibilityChange);
		this.pushEnv?.serviceWorker.addEventListener("message", onWorkerMessage);
		return () => {
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("hashchange", onHashChange);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			this.pushEnv?.serviceWorker.removeEventListener("message", onWorkerMessage);
			clearTimeout(this.awayTimeoutID);
		};
	},

	/** Mark the user as away while the page stays hidden, see
	 * draft/pre-away. Briefly switching tabs doesn't count. */
	handleVisibilityChange(this: AppController): void {
		clearTimeout(this.awayTimeoutID);
		const minutes = this.state.settings.autoAwayMinutes;
		if (document.visibilityState !== "hidden" || minutes <= 0) {
			this.setPresent(true);
			return;
		}
		this.awayTimeoutID = setTimeout(() => this.setPresent(false), minutes * 60 * 1000);
	},

	/** Set or clear (with null or "") the away message on all connections. */
	setAway(this: AppController, message: string | null): void {
		const awayMessage = message || null;
		this.update({ awayMessage });
		for (const client of this.clients.values()) {
			client.setAway(awayMessage);
		}
	},

	setPresent(this: AppController, present: boolean): void {
		this.present = present;
		for (const client of this.clients.values()) {
			client.setPresent(present);
		}
	},

	/** Handle messages from the service worker, e.g. a clicked push notification. */
	handleWorkerMessage(this: AppController, data: unknown): void {
		if (!data || typeof data !== "object" || (data as { type?: string }).type !== "open-buffer") {
			return;
		}
		const target = (data as { target?: string }).target;
		if (!target) {
			return;
		}
		// Push notifications don't say which network they're from. Don't join
		// or open anything: the notification may be from another network.
		const buf = this.findBufferOnAnyServer(target);
		if (!buf) {
			console.warn(`No buffer found for push notification target "${target}"`);
			return;
		}
		this.switchBuffer(buf.id);
	},
};

export type WindowMethods = typeof windowMethods;
