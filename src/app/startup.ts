/** Startup: configuration, URL parameters and OAuth 2.0 sign-in. */

import * as irc from "../lib/irc";
import * as oauth2 from "../lib/oauth2";
import type Client from "../lib/client";
import * as store from "../store";
import type { ConnectParams } from "./store";
import { parseQueryString, parseWindowHash, randomNick, type Config } from "./config";
import type AppController from "./controller";

/** Fill connection parameters from config.json, dropping invalid settings. */
function applyConfigFile(config: Config, connectParams: ConnectParams): void {
	if (typeof config.server.url === "string") {
		connectParams.url = config.server.url;
	}
	if (Array.isArray(config.server.autojoin)) {
		connectParams.autojoin = config.server.autojoin;
	} else if (typeof config.server.autojoin === "string") {
		connectParams.autojoin = [config.server.autojoin];
	}
	if (typeof config.server.nick === "string") {
		connectParams.nick = config.server.nick;
	}
	if (typeof config.server.autoconnect === "boolean") {
		connectParams.autoconnect = config.server.autoconnect;
	}
	if (config.server.auth === "external") {
		connectParams.saslExternal = true;
	}
	if (typeof config.server.ping === "number") {
		connectParams.ping = config.server.ping;
	}

	if (connectParams.autoconnect && config.server.auth === "mandatory") {
		console.error(
			'Error in config.json: cannot set server.autoconnect = true and server.auth = "mandatory"',
		);
		connectParams.autoconnect = false;
	}
	if (
		config.server.auth === "oauth2" &&
		(!config.oauth2 || !config.oauth2.url || !config.oauth2.client_id)
	) {
		console.error('Error in config.json: server.auth = "oauth2" requires oauth2 settings');
		config.server.auth = null;
	}
}

export const startupMethods = {
	/**
	 * Handle configuration data and populate the connection parameters.
	 * The priority order is:
	 * - URL params
	 * - Saved parameters in local storage
	 * - Configuration data (fetched from the config.json file)
	 * - Default server URL constructed from the current URL location
	 */
	async handleConfig(this: AppController, config: Config): Promise<void> {
		let connectParams: ConnectParams = { ...this.state.connectParams };
		applyConfigFile(config, connectParams);

		const autoconnect = store.autoconnect.load();
		if (autoconnect) {
			connectParams = {
				...connectParams,
				...autoconnect,
				autoconnect: true,
				autojoin: [], // handled by store.BufferStore
			} as ConnectParams;
		}

		let autojoin: string[] = [];

		const queryParams = parseQueryString(window.location.search);
		// Don't allow to silently override the server URL if there's one in
		// config.json or a remembered login: a link would send the user, and
		// the remembered credentials, to another server. But still allow
		// setting server to an empty string to reveal the server field in the
		// connect form, without the remembered login.
		if (typeof queryParams.server === "string") {
			if (!queryParams.server) {
				if (autoconnect) {
					connectParams = { ...this.state.connectParams };
					applyConfigFile(config, connectParams);
				}
				connectParams.autoconnect = false;
			}
			if (!queryParams.server || (!connectParams.url && !autoconnect)) {
				connectParams.url = queryParams.server;

				// When using a custom server, some configuration options don't
				// make sense anymore.
				config.server.auth = null;
			}
		}
		if (typeof queryParams.nick === "string") {
			connectParams.nick = queryParams.nick;
		}
		if (typeof queryParams.channels === "string") {
			autojoin = queryParams.channels.split(",").filter(Boolean);
		}
		if (typeof queryParams.open === "string") {
			this.autoOpenURL = irc.parseURL(queryParams.open);
		}
		if (queryParams.debug === "1") {
			this.debug = true;
		} else if (queryParams.debug === "0") {
			this.debug = false;
		}

		if (window.location.hash) {
			if (window.location.hash.startsWith("#/")) {
				this.initialRoute = parseWindowHash(window.location.hash);
			} else {
				autojoin = window.location.hash.split(",").filter(Boolean);
			}
		}

		this.config = config;

		if (!connectParams.nick && connectParams.autoconnect) {
			connectParams.nick = "user-*";
		}
		if (connectParams.nick && connectParams.nick.includes("*")) {
			connectParams.nick = randomNick(connectParams.nick);
		}

		const expiresAt = connectParams.saslOauthBearer?.expiresAt;
		if (expiresAt && expiresAt <= Date.now()) {
			console.log("Remembered OAuth 2.0 token expired");
			connectParams.saslOauthBearer = null;
		}
		if (config.server.auth === "oauth2" && !connectParams.saslOauthBearer) {
			if (!(await this.handleOauth2Redirect(queryParams, connectParams))) {
				return;
			}
		}

		if (autojoin.length > 0) {
			if (connectParams.autoconnect) {
				// Ask the user whether they want to join that new channel.
				// TODO: support multiple channels here
				this.autoOpenURL = { host: "", entity: autojoin[0] };
			} else {
				connectParams.autojoin = autojoin;
			}
		}

		this.update({ loading: false, connectParams });

		if (connectParams.autoconnect) {
			this.update({ connectForm: false });
			this.connect(connectParams);
		}
	},

	/**
	 * Get an OAuth 2.0 token, from the authorization code in the URL or by
	 * redirecting to the authorization server. Returns false if the token
	 * isn't available (yet).
	 */
	async handleOauth2Redirect(
		this: AppController,
		queryParams: Record<string, string>,
		connectParams: ConnectParams,
	): Promise<boolean> {
		// Strip the authorization response from the URL: reloading the page
		// mustn't exchange the code again, or show the error again instead
		// of starting a new authorization
		const stripResponse = () => {
			const url = new URL(window.location.toString());
			for (const k of ["code", "state", "error", "error_description", "error_uri"]) {
				url.searchParams.delete(k);
			}
			window.history.replaceState(null, "", url.toString());
		};

		if (queryParams.error) {
			console.error("OAuth 2.0 authorization failed: ", queryParams.error);
			stripResponse();
			this.showError("Authentication failed: " + (queryParams.error_description || queryParams.error));
			return false;
		}

		if (!queryParams.code) {
			await this.redirectOauth2Authorize();
			return false;
		}

		stripResponse();

		let saslOauthBearer;
		try {
			const state = typeof queryParams.state === "string" ? queryParams.state : undefined;
			const pending = oauth2.takePendingAuthorization(state);
			saslOauthBearer = await this.exchangeOauth2Code(queryParams.code, pending);
		} catch (err) {
			this.showError(err);
			return false;
		}

		connectParams.saslOauthBearer = saslOauthBearer;

		if (saslOauthBearer.username && !connectParams.nick) {
			connectParams.nick = saslOauthBearer.username;
		}
		return true;
	},

	async redirectOauth2Authorize(this: AppController): Promise<void> {
		const oauth2Config = this.config.oauth2!;
		let serverMetadata;
		try {
			serverMetadata = await oauth2.fetchServerMetadata(oauth2Config.url);
		} catch (err) {
			console.error("Failed to fetch OAuth 2.0 server metadata:", err);
			this.showError("Failed to fetch OAuth 2.0 server metadata");
			return;
		}

		try {
			await oauth2.redirectAuthorize({
				serverMetadata,
				clientId: oauth2Config.client_id,
				redirectUri: oauth2.canonicalRedirectURI(window.location.toString()),
				scope: oauth2Config.scope,
			});
		} catch (err) {
			this.showError(err);
		}
	},

	async exchangeOauth2Code(
		this: AppController,
		code: string,
		pending: oauth2.PendingAuthorization,
	): Promise<{ token: string; username: string | null; expiresAt: number | null }> {
		const oauth2Config = this.config.oauth2!;
		const serverMetadata = await oauth2.fetchServerMetadata(oauth2Config.url);

		const data = await oauth2.exchangeCode({
			serverMetadata,
			redirectUri: pending.redirectUri,
			code,
			codeVerifier: pending.codeVerifier,
			clientId: oauth2Config.client_id,
			clientSecret: oauth2Config.client_secret,
		});

		// TODO: handle refresh_token
		const token = data.access_token;
		const expiresAt =
			typeof data.expires_in === "number" && data.expires_in > 0
				? Date.now() + data.expires_in * 1000
				: null;

		let username: string | null = null;
		if (serverMetadata.introspection_endpoint) {
			try {
				const data = await oauth2.introspectToken({
					serverMetadata,
					token,
					clientId: oauth2Config.client_id,
					clientSecret: oauth2Config.client_secret,
				});
				username = data.username ?? null;
				if (!username) {
					console.warn("Username missing from OAuth 2.0 token introspection response");
				}
			} catch (err) {
				console.warn("Failed to introspect OAuth 2.0 token:", err);
			}
		}

		return { token, username, expiresAt };
	},

	/**
	 * The server rejected the OAuth 2.0 token, e.g. revoked or expired: forget
	 * it, and show the connect form to authorize again.
	 */
	handleOauth2TokenRejected(this: AppController, client: Client): void {
		client.params.saslOauthBearer = null;
		if (client.params.bouncerNetwork) {
			return;
		}
		this.update((state) => ({
			connectParams: { ...state.connectParams, saslOauthBearer: null },
			connectForm: true,
		}));
		const autoconnect = store.autoconnect.load();
		if (autoconnect?.saslOauthBearer) {
			store.autoconnect.put({ ...autoconnect, saslOauthBearer: null });
		}
	},
};

export type StartupMethods = typeof startupMethods;
