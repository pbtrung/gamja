interface ServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	introspection_endpoint?: string;
	response_types_supported: string[];
}

import * as base64 from "./base64";

/** sessionStorage key of the authorization request awaiting its redirect */
const PENDING_KEY = "gamja_oauth2_pending";

export interface PendingAuthorization {
	state: string;
	/** PKCE code verifier, empty if PKCE isn't available */
	codeVerifier: string;
	/** Redirect URI sent with the request, the code exchange must repeat it */
	redirectUri: string;
}

/**
 * The redirect URI for the current page: without the fragment, which redirect
 * URIs can't have, nor the parameters the authorization server appends.
 */
export function canonicalRedirectURI(loc: string): string {
	const url = new URL(loc);
	url.hash = "";
	for (const k of ["code", "state", "iss", "session_state", "error", "error_description"]) {
		url.searchParams.delete(k);
	}
	return url.toString();
}

function randomString(): string {
	const buf = new Uint8Array(32);
	crypto.getRandomValues(buf);
	return base64.encodeURL(buf.buffer);
}

function formatQueryString(params: Record<string, string>): string {
	return new URLSearchParams(params).toString();
}

function checkResponse(resp: Response): void {
	if (!resp.ok) {
		throw new Error(`HTTP error: ${resp.status} ${resp.statusText}`);
	}
}

/**
 * Read the JSON body of a token or introspection endpoint response. Errors
 * come with a JSON body too, which tells more than the HTTP status, see
 * RFC 6749 section 5.2.
 */
async function readEndpointResponse(resp: Response) {
	let data;
	try {
		data = await resp.json();
	} catch (err) {
		checkResponse(resp);
		throw err;
	}
	if (data?.error) {
		throw new Error("Authentication failed: " + (data.error_description || data.error));
	}
	checkResponse(resp);
	return data;
}

/**
 * The URLs where an issuer may publish its metadata, in the order to try them.
 * With a path, Authorization Server Metadata inserts the well-known path
 * before it (RFC 8414 section 3.1) while OpenID Connect Discovery appends it.
 * Appending the former too is kept for servers relying on it.
 */
function metadataURLs(issuer: string): string[] {
	const url = new URL(issuer.replace(/\/+$/, ""));
	const path = url.pathname.replace(/\/+$/, "");
	const origin = url.origin;
	if (!path) {
		return [
			origin + "/.well-known/oauth-authorization-server",
			origin + "/.well-known/openid-configuration",
		];
	}
	return [
		origin + "/.well-known/oauth-authorization-server" + path,
		origin + path + "/.well-known/oauth-authorization-server",
		origin + path + "/.well-known/openid-configuration",
	];
}

export async function fetchServerMetadata(url: string): Promise<ServerMetadata> {
	const urls = metadataURLs(url);
	let resp: Response | null = null;
	for (const [i, u] of urls.entries()) {
		try {
			resp = await fetch(u);
			checkResponse(resp);
			break;
		} catch (err) {
			if (i === urls.length - 1) {
				throw err;
			}
			console.warn(`OAuth 2.0 server metadata not found at ${u}, trying ${urls[i + 1]}:`, err);
		}
	}

	const data = await resp!.json();
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
	const pending: PendingAuthorization = { state: randomString(), codeVerifier: "", redirectUri };
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
	try {
		sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
	} catch (err) {
		throw new Error("OAuth 2.0 login requires session storage, which is disabled", { cause: err });
	}
	// The endpoint may already have a query, which must be kept (RFC 6749 section 3.1)
	const url = new URL(serverMetadata.authorization_endpoint);
	for (const [k, v] of Object.entries(params)) {
		url.searchParams.set(k, v);
	}
	window.location.assign(url.toString());
}

/**
 * Check the state the server redirected back with against the pending
 * authorization request, and return its PKCE code verifier.
 */
export function takePendingAuthorization(state: string | undefined): PendingAuthorization {
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
	return pending;
}

/** Encode a value as in application/x-www-form-urlencoded, e.g. spaces as "+". */
function formEncode(s: string): string {
	return new URLSearchParams([["", s]]).toString().slice(1);
}

function buildPostHeaders(clientId: string, clientSecret?: string): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/x-www-form-urlencoded",
		Accept: "application/json",
	};
	if (clientSecret) {
		// The credentials are form-encoded first, see RFC 6749 section 2.3.1
		headers["Authorization"] = "Basic " + btoa(formEncode(clientId) + ":" + formEncode(clientSecret));
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
}): Promise<{ access_token: string; expires_in?: number }> {
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
	const data = await readEndpointResponse(resp);
	if (typeof data?.access_token !== "string" || !data.access_token) {
		throw new Error("Missing access_token in response");
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
	const data = await readEndpointResponse(resp);
	if (!data.active) {
		throw new Error("Expired token");
	}
	return data;
}
