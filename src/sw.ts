/// <reference lib="webworker" />
// Service worker displaying Web Push notifications sent by the IRC server
// (soju.im/webpush). Each push payload is a single raw IRC message.
import { parseMessage, parseCTCP, type Message } from "./lib/irc";
import { strip as stripANSI } from "./lib/ansi";
import { formatWindowHash } from "./app/config";

declare const self: ServiceWorkerGlobalScope;

interface PushNotification {
	title: string;
	body: string;
	tag: string;
	/** Buffer to open when the notification is clicked */
	target: string;
}

/** Build a notification for an IRC message, or null if it isn't worth one. */
export function notificationForMessage(msg: Message): PushNotification | null {
	const from = msg.prefix?.name ?? "*";
	const msgid = msg.tags.msgid;
	switch (msg.command) {
		case "PRIVMSG":
		case "NOTICE": {
			const [rawTarget, text = ""] = msg.params;
			if (!rawTarget) {
				return null;
			}
			// Without the server's CHANTYPES and STATUSMSG at hand: skip the
			// prefix of messages sent to the ops of a channel, e.g. @#chan
			const channel = /^[~&@%+]*([#&+!].*)$/.exec(rawTarget)?.[1];
			const isChannel = channel !== undefined;
			const target = channel ?? rawTarget;
			const ctcp = parseCTCP(msg);
			if (ctcp && ctcp.command !== "ACTION") {
				return null;
			}
			const body = ctcp ? `* ${from} ${ctcp.param}` : text;
			return {
				title: isChannel ? `${from} in ${target}` : from,
				body: stripANSI(body),
				tag: msgid ? "msg:" + msgid : `msg:${from}:${target}`,
				target: isChannel ? target : from,
			};
		}
		case "INVITE": {
			const channel = msg.params[1];
			if (!channel) {
				return null;
			}
			return {
				title: `Invitation to ${channel}`,
				body: `${from} has invited you to ${channel}`,
				tag: `invite:${channel}`,
				target: channel,
			};
		}
		default:
			return null;
	}
}

/**
 * Buffer read elsewhere, if the message says so: soju pushes MARKREAD when
 * another client reads a buffer, its notifications are stale then.
 */
export function readTarget(msg: Message): string | null {
	return msg.command === "MARKREAD" && msg.params[0] ? msg.params[0] : null;
}

async function closeNotifications(target: string): Promise<void> {
	const lower = target.toLowerCase();
	for (const notif of await self.registration.getNotifications()) {
		const notifTarget: unknown = notif.data?.target;
		if (typeof notifTarget === "string" && notifTarget.toLowerCase() === lower) {
			notif.close();
		}
	}
}

/**
 * The windows of this gamja installation, focused ones first: other pages of
 * the origin, outside the service worker's scope, are someone else's.
 */
export function appWindows<T extends Pick<WindowClient, "url" | "focused">>(
	clients: readonly T[],
	scope: string,
): T[] {
	return clients
		.filter((c) => c.url.startsWith(scope))
		.sort((a, b) => Number(b.focused) - Number(a.focused));
}

async function getAppWindows(): Promise<WindowClient[]> {
	const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
	return appWindows(clients, self.registration.scope);
}

async function hasFocusedClient(): Promise<boolean> {
	const clients = await getAppWindows();
	return clients.some((c) => c.focused && c.visibilityState === "visible");
}

if (typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope) {
	self.addEventListener("install", () => {
		void self.skipWaiting();
	});

	self.addEventListener("activate", (event) => {
		event.waitUntil(self.clients.claim());
	});

	// The subscription is userVisibleOnly: browsers expect each push to show
	// a notification. Some of them don't (MARKREAD, unparsable payloads,
	// soju's own NOTEs, messages while a window is focused). Chrome tolerates
	// a few such silent pushes, then shows a generic "site updated in the
	// background" notification. Showing a notification for these would be
	// worse, e.g. one for every buffer read on another device, so accept it.
	self.addEventListener("push", (event) => {
		const raw = event.data?.text();
		if (!raw) {
			return;
		}
		event.waitUntil(
			(async () => {
				let msg: Message;
				try {
					msg = parseMessage(raw);
				} catch (err) {
					console.error("Failed to parse push message:", raw, err);
					return;
				}
				const read = readTarget(msg);
				if (read) {
					await closeNotifications(read);
					return;
				}
				// Anything else without a notification, e.g. soju's
				// "NOTE WEBPUSH REGISTERED", is ignored
				const notif = notificationForMessage(msg);
				if (!notif || (await hasFocusedClient())) {
					// The open page shows its own notifications
					return;
				}
				await self.registration.showNotification(notif.title, {
					body: notif.body,
					tag: notif.tag,
					icon: "icon-192.png",
					badge: "icon-192.png",
					data: { target: notif.target },
				});
			})(),
		);
	});

	self.addEventListener("notificationclick", (event) => {
		event.notification.close();
		const target: string | undefined = event.notification.data?.target;
		event.waitUntil(
			(async () => {
				const [client] = await getAppWindows();
				if (client) {
					await client.focus();
					client.postMessage({ type: "open-buffer", target });
					return;
				}
				const url = new URL(self.registration.scope);
				if (target) {
					url.hash = formatWindowHash(null, target);
				}
				await self.clients.openWindow(url.toString());
			})(),
		);
	});
}
