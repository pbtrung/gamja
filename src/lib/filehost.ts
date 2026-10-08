import type Client from "./client";
import * as base64 from "./base64";

function encodeContentDisposition(filename: string): string {
	// Encode filename according to RFC 5987 if necessary. Note,
	// encodeURIComponent will percent-encode a superset of attr-char.
	const encodedFilename = encodeURIComponent(filename);
	if (encodedFilename === filename) {
		return 'attachment; filename="' + filename + '"';
	} else {
		return "attachment; filename*=UTF-8''" + encodedFilename;
	}
}

/** Upload a file to the soju.im/FILEHOST endpoint. Returns the file URL. */
export async function uploadFile(client: Client, file: File, signal?: AbortSignal): Promise<URL> {
	const endpointStr = client.isupport.filehost();
	if (!endpointStr) {
		throw new Error("Server doesn't support file uploads");
	}
	const endpoint = new URL(endpointStr, location.href);
	// Don't leak credentials over plain HTTP when the IRC connection is secure
	if (endpoint.protocol !== "https:" && client.params.url.startsWith("wss:")) {
		throw new Error("Refusing to upload files to an insecure endpoint");
	}

	let auth: string | undefined;
	if (client.params.saslPlain) {
		const params = client.params.saslPlain;
		auth = "Basic " + base64.encode(params.username + ":" + params.password);
	} else if (client.params.saslOauthBearer) {
		auth = "Bearer " + client.params.saslOauthBearer.token;
	}

	const headers: Record<string, string> = {
		"Content-Disposition": encodeContentDisposition(file.name),
	};
	if (file.type) {
		headers["Content-Type"] = file.type;
	}
	if (auth) {
		headers["Authorization"] = auth;
	}

	const resp = await fetch(endpoint.href, {
		method: "POST",
		body: file,
		headers,
		// Only send cookies to our own origin
		credentials: endpoint.origin === location.origin ? "include" : "omit",
		signal,
	});

	if (!resp.ok) {
		throw new Error(`HTTP request failed (${resp.status})`);
	}

	const loc = resp.headers.get("Location");
	if (!loc) {
		throw new Error("filehost response missing Location header field");
	}

	return new URL(loc, endpoint);
}
