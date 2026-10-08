import * as base64 from "../lib/base64";
import type Client from "../lib/client";

/** Browser APIs needed for Web Push, injectable for tests. */
export interface PushEnvironment {
	serviceWorker: ServiceWorkerContainer;
	Notification: typeof Notification;
	swURL: string;
}

export function getPushEnvironment(): PushEnvironment | null {
	if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
		return null;
	}
	return {
		serviceWorker: navigator.serviceWorker,
		Notification: window.Notification,
		swURL: import.meta.env.DEV ? "./sw.ts" : "./sw.js",
	};
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
	if (!a) {
		return false;
	}
	const x = new Uint8Array(a);
	return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** Get a push subscription for the given VAPID key, creating one if needed. */
export async function subscribe(env: PushEnvironment, vapid: string): Promise<PushSubscription> {
	const registration = await env.serviceWorker.register(env.swURL, { type: "module" });
	await env.serviceWorker.ready;

	const applicationServerKey = base64.decodeURL(vapid);
	let subscription = await registration.pushManager.getSubscription();
	if (subscription && !sameKey(subscription.options.applicationServerKey, applicationServerKey)) {
		// Subscribed with another server's key
		await subscription.unsubscribe();
		subscription = null;
	}
	if (!subscription) {
		subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey,
		});
	}
	return subscription;
}

export async function getSubscription(env: PushEnvironment): Promise<PushSubscription | null> {
	const registration = await env.serviceWorker.getRegistration(env.swURL);
	return (await registration?.pushManager.getSubscription()) ?? null;
}

export function subscriptionKeys(subscription: PushSubscription): Record<string, string> {
	return {
		p256dh: base64.encodeURL(subscription.getKey("p256dh")),
		auth: base64.encodeURL(subscription.getKey("auth")),
	};
}

/** Register the subscription on an IRC connection. */
export async function registerClient(client: Client, subscription: PushSubscription): Promise<void> {
	await client.registerWebPush(subscription.endpoint, subscriptionKeys(subscription));
}
