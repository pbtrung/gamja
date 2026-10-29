/** Web Push notifications: subscribing and registering connections. */

import type Client from "../lib/client";
import * as webpush from "./webpush";
import type AppController from "./controller";

export const pushMethods = {
	/** Whether Web Push can be enabled: supported by the browser and a server. */
	canEnablePush(this: AppController): boolean {
		if (!this.pushEnv) {
			return false;
		}
		for (const server of this.state.servers.values()) {
			if (server.features.webPush) {
				return true;
			}
		}
		return false;
	},

	/** Turn Web Push notifications on or off for all connections. */
	async setPushNotifications(this: AppController, enabled: boolean): Promise<void> {
		const env = this.pushEnv;
		if (!env) {
			throw new Error("Push notifications aren't supported by this browser");
		}
		if (enabled) {
			const permission = await env.Notification.requestPermission();
			if (permission !== "granted") {
				throw new Error("Notification permission denied");
			}
			const clients = [...this.clients.values()].filter((c) => c.supportsWebPush());
			if (clients.length === 0) {
				throw new Error("The server doesn't support push notifications");
			}
			const subscription = await webpush.subscribe(env, clients[0].isupport.vapid()!);
			await Promise.all(clients.map((c) => webpush.registerClient(c, subscription)));
		} else {
			const subscription = await webpush.getSubscription(env);
			if (subscription) {
				await Promise.all(
					[...this.clients.values()]
						.filter((c) => c.supportsWebPush())
						.map((c) => c.unregisterWebPush(subscription.endpoint).catch(() => {})),
				);
				await subscription.unsubscribe();
			}
		}
		this.handleSettingsChange({ pushNotifications: enabled });
	},

	/** Re-register the push subscription after connecting, servers may expire them. */
	async refreshPushRegistration(this: AppController, client: Client): Promise<void> {
		if (!this.pushEnv || !this.state.settings.pushNotifications || !client.supportsWebPush()) {
			return;
		}
		if (this.pushEnv.Notification.permission !== "granted") {
			return;
		}
		const subscription = await webpush.subscribe(this.pushEnv, client.isupport.vapid()!);
		await webpush.registerClient(client, subscription);
	},
};

export type PushMethods = typeof pushMethods;
