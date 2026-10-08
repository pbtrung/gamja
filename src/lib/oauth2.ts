export interface ServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	introspection_endpoint?: string;
	response_types_supported: string[];
}

import * as base64 from "./base64";

/** sessionStorage key of the authorization request awaiting its redirect */
const PENDING_KEY = "gamja_oauth2_pending";

interface PendingAuthorization {
	state: string;
	/** PKCE code verifier, empty if PKCE isn't available */
	codeVerifier: string;
}

function randomString(): string {
	const buf = new Uint8Array(32);
	crypto.getRandomValues(buf);
	return base64.encodeURL(buf.buffer);
}

function formatQueryString(params: Record<string, string>): string {
	return new URLSearchParams(params).toString();
}

export async function fetchServerMetadata(url: string): Promise<ServerMetadata> {
	// TODO: handle path in config.oauth2.url
	let resp: Response;
	try {
		resp = await fetch(url + "/.well-known/oauth-authorization-server");
		if (!resp.ok) {
			throw new Error(`HTTP error: ${resp.status} ${resp.statusText}`);
		}
	} catch (err) {
		console.warn(
			"OAuth 2.0 server doesn't support Authorization Server Metadata (retrying with OpenID Connect Discovery): ",
			err,
		);
		resp = await fetch(url + "/.well-known/openid-configuration");
	}
	if (!resp.ok) {
		throw new Error(`HTTP error: ${resp.status} ${resp.statusText}`);
	}

	const data = await resp.json();
	if (!data.issuer) {
		throw new Error("Missing issuer in response");
	}
	if (!data.authorization_endpoint) {
		throw new Error("Missing authorization_endpoint in response");
	}
	if (!data.token_endpoint) {
		throw new Error("Missing token_endpoint in response");
	}
	if (!data.response_types_supported?.includes("code")) {
		throw new Error("Server doesn't support authorization code response type");
	}
	return data;
}

export async function redirectAuthorize({
	serverMetadata,
	clientId,
	redirectUri,
	scope,
}: {
	serverMetadata: ServerMetadata;
	clientId: string;
	redirectUri: string;
	scope?: string;
}): Promise<void> {
	// The state prevents cross-site request forgery, PKCE code injection.
	// Servers without PKCE support ignore its parameters.
	const pending: PendingAuthorization = { state: randomString(), codeVerifier: "" };
	const params: Record<string, string> = {
		response_type: "code",
		client_id: clientId,
		redirect_uri: redirectUri,
		state: pending.state,
	};
	if (scope) {
		params.scope = scope;
	}
	// crypto.subtle is only available in secure contexts
	if (globalThis.crypto?.subtle) {
		pending.codeVerifier = randomString();
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pending.codeVerifier));
		params.code_challenge = base64.encodeURL(digest);
		params.code_challenge_method = "S256";
	}
	sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
	window.location.assign(serverMetadata.authorization_endpoint + "?" + formatQueryString(params));
}

/**
 * Check the state the server redirected back with against the pending
 * authorization request, and return its PKCE code verifier.
 */
export function takePendingAuthorization(state: string | undefined): string {
	let pending: PendingAuthorization | null = null;
	try {
		const raw = sessionStorage.getItem(PENDING_KEY);
		sessionStorage.removeItem(PENDING_KEY);
		pending = raw ? (JSON.parse(raw) as PendingAuthorization) : null;
	} catch (err) {
		console.warn("Failed to load the pending OAuth 2.0 authorization:", err);
	}
	if (!pending || !state || pending.state !== state) {
		throw new Error("OAuth 2.0 authorization doesn't match the one we started, please try again");
	}
	return pending.codeVerifier;
}

function buildPostHeaders(clientId: string, clientSecret?: string): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/x-www-form-urlencoded",
		Accept: "application/json",
	};
	if (clientSecret) {
		headers["Authorization"] =
			"Basic " + btoa(encodeURIComponent(clientId) + ":" + encodeURIComponent(clientSecret));
	}
	return headers;
}

export async function exchangeCode({
	serverMetadata,
	redirectUri,
	code,
	codeVerifier,
	clientId,
	clientSecret,
}: {
	serverMetadata: ServerMetadata;
	redirectUri: string;
	code: string;
	/** PKCE code verifier, if the authorization request used PKCE */
	codeVerifier?: string;
	clientId: string;
	clientSecret?: string;
}): Promise<{ access_token: string }> {
	const params: Record<string, string> = {
		grant_type: "authorization_code",
		code,
		redirect_uri: redirectUri,
	};
	if (codeVerifier) {
		params.code_verifier = codeVerifier;
	}
	if (!clientSecret) {
		params["client_id"] = clientId;
	}

	const resp = await fetch(serverMetadata.token_endpoint, {
		method: "POST",
		headers: buildPostHeaders(clientId, clientSecret),
		body: formatQueryString(params),
	});

	if (!resp.ok) {
		throw new Error(`HTTP error: ${resp.status} ${resp.statusText}`);
	}
	const data = await resp.json();

	if (data.error) {
		throw new Error("Authentication failed: " + (data.error_description || data.error));
	}

	return data;
}

export async function introspectToken({
	serverMetadata,
	token,
	clientId,
	clientSecret,
}: {
	serverMetadata: ServerMetadata;
	token: string;
	clientId: string;
	clientSecret?: string;
}): Promise<{ active: boolean; username?: string }> {
	if (!serverMetadata.introspection_endpoint) {
		throw new Error("Server doesn't support token introspection");
	}
	const resp = await fetch(serverMetadata.introspection_endpoint, {
		method: "POST",
		headers: buildPostHeaders(clientId, clientSecret),
		body: formatQueryString({ token }),
	});
	if (!resp.ok) {
		throw new Error(`HTTP error: ${resp.status} ${resp.statusText}`);
	}
	const data = await resp.json();
	if (!data.active) {
		throw new Error("Expired token");
	}
	return data;
}
