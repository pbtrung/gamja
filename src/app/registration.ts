/** Connection registration: restoring buffers, auto-joins and pending routes. */

import * as irc from "../lib/irc";
import type Client from "../lib/client";
import * as S from "../state";
import { SERVER_BUFFER } from "../state";
import { splitHostPort } from "./config";
import type AppController from "./controller";
import { storeServer } from "./history";

/** Maximum length of the channel list of a JOIN, IRC lines are 512 bytes */
const MAX_JOIN_LENGTH = 400;

/**
 * Join channels with as few JOIN commands as possible, each short enough
 * and with no more channels than the server accepts (TARGMAX). Each channel
 * is joined once: restored and auto-joined channels may be the same.
 */
export function joinChannels(client: Client, channels: string[]): void {
	const seen = new Set<string>();
	channels = channels.filter((ch) => {
		const key = client.cm(ch);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
	for (const chunk of irc.chunkTargets(channels, client.isupport.targMax("JOIN"), MAX_JOIN_LENGTH)) {
		client.send({ command: "JOIN", params: [chunk.join(",")] });
	}
}

/**
 * Restore the opened user buffers of a server. Returns the opened channels,
 * to join: on soju, the bouncer joins them itself.
 */
function restoreBuffers(app: AppController, serverID: number, client: Client): string[] {
	const join: string[] = [];
	for (const buf of app.bufferStore.list(storeServer(client))) {
		if (buf.name === SERVER_BUFFER || buf.closed) {
			continue;
		}

		if (client.isChannel(buf.name)) {
			if (client.caps.enabled.has("soju.im/bouncer-networks")) {
				continue;
			}
			join.push(buf.name);
		} else {
			app.createBuffer(serverID, buf.name);
			app.whoUserBuffer(buf.name, serverID);
		}
	}
	return join;
}

/** Open the irc:// URL or the route waiting for this server, if any. */
function openPending(app: AppController, client: Client, serverHost: string): void {
	if (app.autoOpenURL && serverHost === splitHostPort(app.autoOpenURL.host).host) {
		const url = app.autoOpenURL;
		app.autoOpenURL = null;

		// Roundtrip to ensure we've seen any server-initiated JOIN
		// messages sent right after connection registration
		client
			.ping()
			.then(() => app.openURL(url))
			.catch(() => {});
	} else if (app.initialRoute && (!app.initialRoute.host || serverHost === app.initialRoute.host)) {
		const route = app.initialRoute;
		if (route.host) {
			app.initialRoute = null;
		}

		client
			.ping()
			.then(() => {
				// Without a host, e.g. when opened from a push notification,
				// the buffer may be on any server: try again as the others
				// connect, until found
				if (!route.host && app.initialRoute !== route) {
					return;
				}
				if (app.openRoute(route)) {
					app.initialRoute = null;
				}
			})
			.catch(() => {});
	}
}

export const registrationMethods = {
	handleEndOfRegistration(this: AppController, serverID: number, client: Client): void {
		this.refreshPushRegistration(client).catch((err) => {
			console.warn("Failed to register for push notifications:", err);
		});

		// RPL_ENDOFMOTD and ERR_NOMOTD indicate the end of the ISUPPORT list

		if (this.state.servers.get(serverID)?.features.targetMetadata) {
			client.subscribeTargetMetadata(Object.values(S.METADATA_KEYS));
		}

		let join = restoreBuffers(this, serverID, client);

		// Auto-join channels given at connect-time
		const bouncerNetwork = this.getBouncerNetwork(serverID);
		if (!bouncerNetwork || bouncerNetwork.state === "connected") {
			join = join.concat(client.params.autojoin || []);
			client.params.autojoin = [];
		}

		joinChannels(client, join);

		openPending(this, client, bouncerNetwork?.host ?? "");
	},
};

export type RegistrationMethods = typeof registrationMethods;
