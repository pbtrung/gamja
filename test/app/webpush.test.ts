import { describe, expect, it, vi } from "vitest";
import * as webpush from "../../src/app/webpush";
import { encodeURL } from "../../src/lib/base64";
import { connectedApp, flush } from "../helpers/app";

const VAPID = encodeURL(new Uint8Array([4, 1, 2, 3]).buffer);

/** A fake push service: a service worker registration with a push manager. */
function fakePushEnv(permission: NotificationPermission = "granted") {
	let subscription: PushSubscription | null = null;
	const makeSubscription = (key: ArrayBuffer) =>
		({
			endpoint: "https://push.example/sub",
			options: { applicationServerKey: key },
			getKey: (name: string) => new TextEncoder().encode(name === "auth" ? "secret" : "public").buffer,
			unsubscribe: vi.fn(async () => {
				subscription = null;
				return true;
			}),
		}) as unknown as PushSubscription;
	const pushManager = {
		getSubscription: vi.fn(async () => subscription),
		subscribe: vi.fn(async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
			subscription = makeSubscription(applicationServerKey.slice().buffer);
			return subscription;
		}),
	};
	const registration = { pushManager };
	const env: webpush.PushEnvironment = {
		swURL: "./sw.js",
		serviceWorker: {
			register: vi.fn(async () => registration),
			getRegistration: vi.fn(async () => registration),
			ready: Promise.resolve(registration),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		} as unknown as ServiceWorkerContainer,
		Notification: {
			permission,
			requestPermission: vi.fn(async () => permission),
		} as unknown as typeof Notification,
	};
	return { env, pushManager, getSubscription: () => subscription };
}

describe("webpush helpers", () => {
	it("subscribes and reuses subscriptions with the same key", async () => {
		const { env, pushManager } = fakePushEnv();
		const sub = await webpush.subscribe(env, VAPID);
		expect(env.serviceWorker.register).toHaveBeenCalledWith("./sw.js", { type: "module" });
		expect(pushManager.subscribe).toHaveBeenCalledWith({
			userVisibleOnly: true,
			applicationServerKey: new Uint8Array([4, 1, 2, 3]),
		});
		expect(await webpush.subscribe(env, VAPID)).toBe(sub);
		expect(pushManager.subscribe).toHaveBeenCalledTimes(1);

		// Another server key forces a new subscription
		await webpush.subscribe(env, encodeURL(new Uint8Array([9]).buffer));
		expect(sub.unsubscribe).toHaveBeenCalled();
		expect(pushManager.subscribe).toHaveBeenCalledTimes(2);
	});

	it("encodes subscription keys", async () => {
		const { env } = fakePushEnv();
		const sub = await webpush.subscribe(env, VAPID);
		expect(webpush.subscriptionKeys(sub)).toEqual({
			p256dh: encodeURL(new TextEncoder().encode("public").buffer),
			auth: encodeURL(new TextEncoder().encode("secret").buffer),
		});
	});
});

describe("controller push notifications", () => {
	const caps = "batch server-time labeled-response soju.im/webpush";
	const isupport = `CHANTYPES=# NETWORK=T VAPID=${VAPID}`;

	it("enables and disables push", async () => {
		const { app, recv, sent, serverID } = await connectedApp({ caps, isupport });
		const { env } = fakePushEnv();
		app.pushEnv = env;
		expect(app.state.servers.get(serverID)!.features.webPush).toBe(true);
		expect(app.canEnablePush()).toBe(true);

		const enable = app.setPushNotifications(true);
		await flush();
		await flush();
		const reg = sent();
		expect(reg).toEqual([
			`WEBPUSH REGISTER https://push.example/sub ${expect.any(String) && reg[0].split(" ")[3]}`,
		]);
		expect(reg[0]).toMatch(/^WEBPUSH REGISTER https:\/\/push\.example\/sub p256dh=[\w-]+;auth=[\w-]+$/);
		recv(":srv WEBPUSH REGISTER https://push.example/sub");
		await enable;
		expect(app.state.settings.pushNotifications).toBe(true);

		const disable = app.setPushNotifications(false);
		await flush();
		await flush();
		expect(sent()).toEqual(["WEBPUSH UNREGISTER https://push.example/sub"]);
		recv(":srv WEBPUSH UNREGISTER https://push.example/sub");
		await disable;
		expect(app.state.settings.pushNotifications).toBe(false);
	});

	it("fails without permission or server support", async () => {
		const h = await connectedApp({ caps, isupport });
		h.app.pushEnv = fakePushEnv("denied").env;
		await expect(h.app.setPushNotifications(true)).rejects.toThrow("Notification permission denied");

		const h2 = await connectedApp();
		h2.app.pushEnv = fakePushEnv().env;
		expect(h2.app.canEnablePush()).toBe(false);
		await expect(h2.app.setPushNotifications(true)).rejects.toThrow("doesn't support push");

		const h3 = await connectedApp();
		h3.app.pushEnv = null;
		await expect(h3.app.setPushNotifications(true)).rejects.toThrow("aren't supported by this browser");
	});

	it("re-registers after reconnecting", async () => {
		const { app, recv, sent } = await connectedApp({ caps, isupport, register: false });
		app.pushEnv = fakePushEnv().env;
		app.handleSettingsChange({ pushNotifications: true });
		recv(`:srv CAP * LS :${caps}`, `:srv CAP me ACK :${caps}`);
		recv(":srv 001 me :Welcome", `:srv 005 me ${isupport} :ok`, ":srv 376 me :End");
		await flush();
		await flush();
		expect(sent().some((l) => l.startsWith("WEBPUSH REGISTER"))).toBe(true);
	});

	it("opens buffers from notification clicks", async () => {
		const { app, recv } = await connectedApp();
		recv(":me!u@h JOIN #c");
		app.handleWorkerMessage({ type: "open-buffer", target: "#C" });
		expect(app.state.buffers.get(app.state.activeBuffer!)!.name).toBe("#c");
		app.handleWorkerMessage({ type: "other" });
		app.handleWorkerMessage(null);
	});
});
