export interface ServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	introspection_endpoint?: string;
	response_types_supported: string[];
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

export function redirectAuthorize({
	serverMetadata,
	clientId,
	redirectUri,
	scope,
}: {
	serverMetadata: ServerMetadata;
	clientId: string;
	redirectUri: string;
	scope?: string;
}): void {
	// TODO: use the state param to prevent cross-site request forgery
	const params: Record<string, string> = {
		response_type: "code",
		client_id: clientId,
		redirect_uri: redirectUri,
	};
	if (scope) {
		params.scope = scope;
	}
	window.location.assign(serverMetadata.authorization_endpoint + "?" + formatQueryString(params));
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
	clientId,
	clientSecret,
}: {
	serverMetadata: ServerMetadata;
	redirectUri: string;
	code: string;
	clientId: string;
	clientSecret?: string;
}): Promise<{ access_token: string }> {
	const params: Record<string, string> = {
		grant_type: "authorization_code",
		code,
		redirect_uri: redirectUri,
	};
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
