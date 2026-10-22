/** SASL authentication helpers. */

import * as base64 from "../base64";

export interface SASLPlain {
	username: string;
	password: string;
}

export interface SASLOAuthBearer {
	token: string;
	username?: string | null;
}

/**
 * The initial SASL response of a mechanism. It's sent right away, without
 * waiting for the server's empty challenge, to avoid a roundtrip.
 */
export function initialResponse(mechanism: string, params?: SASLPlain | SASLOAuthBearer): string {
	switch (mechanism) {
		case "PLAIN": {
			const p = params as SASLPlain;
			return "\0" + p.username + "\0" + p.password;
		}
		case "EXTERNAL":
			return "";
		case "OAUTHBEARER": {
			const p = params as SASLOAuthBearer;
			return "n,,\x01auth=Bearer " + p.token + "\x01\x01";
		}
		default:
			throw new Error(`Unknown authentication mechanism '${mechanism}'`);
	}
}

/** Turn an OAUTHBEARER error challenge into an error, see RFC 7628 section 3.2.2. */
export function parseOAuthBearerError(challenge: string): Error {
	let status: string | undefined;
	try {
		const data = JSON.parse(new TextDecoder().decode(base64.decodeURL(challenge)));
		status = typeof data?.status === "string" ? data.status : undefined;
	} catch (err) {
		console.warn("Failed to parse OAUTHBEARER challenge:", challenge, err);
	}
	switch (status) {
		case "invalid_token":
			return new Error("OAuth 2.0 token invalid or expired, please log in again");
		case "insufficient_scope":
			return new Error("OAuth 2.0 token doesn't grant enough permissions");
		case undefined:
			return new Error("OAuth 2.0 authentication failed");
		default:
			return new Error("OAuth 2.0 authentication failed: " + status);
	}
}
