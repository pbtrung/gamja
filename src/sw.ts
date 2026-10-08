/// <reference lib="webworker" />
// Service worker displaying Web Push notifications sent by the IRC server
// (soju.im/webpush). Each push payload is a single raw IRC message.
import { parseMessage, parseCTCP, type Message } from "./lib/irc";
import { strip as stripANSI } from "./lib/ansi";

declare const self: ServiceWorkerGlobalScope;

export interface PushNotification {
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
			const [target, text = ""] = msg.params;
			const isChannel = /^[#&+!]/.test(target);
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
		case "INVITE":
			return {
				title: `Invitation to ${msg.params[1]}`,
				body: `${from} has invited you to ${msg.params[1]}`,
				tag: `invite:${msg.params[1]}`,
				target: msg.params[1],
			};
		default:
			return null;
	}
}

async function hasFocusedClient(): Promise<boolean> {
	const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
	return clients.some((c) => c.focused && c.visibilityState === "visible");
}

if (typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope) {
	self.addEventListener("install", () => {
		void self.skipWaiting();
	});

	self.addEventListener("activate", (event) => {
		event.waitUntil(self.clients.claim());
	});

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
				const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
				const client = clients[0];
				if (client) {
					await client.focus();
					client.postMessage({ type: "open-buffer", target });
					return;
				}
				const url = new URL(self.registration.scope);
				if (target) {
					url.hash = "/" + target;
				}
				await self.clients.openWindow(url.toString());
			})(),
		);
	});
}
