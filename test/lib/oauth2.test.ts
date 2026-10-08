import { describe, expect, it, vi } from "vitest";
import * as oauth2 from "../../src/lib/oauth2";

const metadata = {
	issuer: "https://auth.example",
	authorization_endpoint: "https://auth.example/authorize",
	token_endpoint: "https://auth.example/token",
	introspection_endpoint: "https://auth.example/introspect",
	response_types_supported: ["code"],
};

function jsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

describe("oauth2", () => {
	it("fetches metadata and falls back to OpenID discovery", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response("", { status: 404 }))
			.mockResolvedValueOnce(jsonResponse(metadata));
		vi.stubGlobal("fetch", fetch);
		await expect(oauth2.fetchServerMetadata("https://auth.example")).resolves.toEqual(metadata);
		expect(fetch.mock.calls[1][0]).toBe("https://auth.example/.well-known/openid-configuration");
	});

	it("validates metadata", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(jsonResponse({ ...metadata, response_types_supported: ["token"] })),
		);
		await expect(oauth2.fetchServerMetadata("https://auth.example")).rejects.toThrow(
			/authorization code/,
		);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(jsonResponse({ ...metadata, token_endpoint: undefined })),
		);
		await expect(oauth2.fetchServerMetadata("https://auth.example")).rejects.toThrow(/token_endpoint/);
	});

	it("sends a state and a PKCE challenge, then checks them on return", async () => {
		const assign = vi.fn();
		vi.stubGlobal("location", { ...window.location, assign });
		await oauth2.redirectAuthorize({
			serverMetadata: metadata,
			clientId: "id",
			redirectUri: "https://gamja.example/",
		});
		const url = new URL(assign.mock.calls[0][0]);
		const state = url.searchParams.get("state")!;
		expect(state).toMatch(/^[\w-]{43}$/);
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		const verifier = JSON.parse(sessionStorage.getItem("gamja_oauth2_pending")!).codeVerifier;
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
		const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		expect(url.searchParams.get("code_challenge")).toBe(challenge);

		expect(() => oauth2.takePendingAuthorization("forged")).toThrow(/doesn't match/);
		// The pending request is single-use
		expect(() => oauth2.takePendingAuthorization(state)).toThrow(/doesn't match/);
		vi.unstubAllGlobals();
	});

	it("builds redirect URIs without fragments or authorization parameters", () => {
		expect(
			oauth2.canonicalRedirectURI("https://gamja.example/app/?server=x&code=c&state=s&iss=i#/#chan"),
		).toBe("https://gamja.example/app/?server=x");
	});

	it("returns the code verifier for a matching state", () => {
		const pending = { state: "s", codeVerifier: "v", redirectUri: "https://gamja.example/" };
		sessionStorage.setItem("gamja_oauth2_pending", JSON.stringify(pending));
		expect(oauth2.takePendingAuthorization("s")).toEqual(pending);
		expect(sessionStorage.getItem("gamja_oauth2_pending")).toBeNull();
	});

	it("sends the PKCE code verifier with the code", async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({ access_token: "tok" }));
		vi.stubGlobal("fetch", fetch);
		await oauth2.exchangeCode({
			serverMetadata: metadata,
			redirectUri: "x",
			code: "c",
			codeVerifier: "v",
			clientId: "id",
		});
		expect(new URLSearchParams(fetch.mock.calls[0][1].body).get("code_verifier")).toBe("v");
	});

	it("exchanges codes with client secrets", async () => {
		const fetch = vi.fn().mockResolvedValue(jsonResponse({ access_token: "tok" }));
		vi.stubGlobal("fetch", fetch);
		const data = await oauth2.exchangeCode({
			serverMetadata: metadata,
			redirectUri: "https://app/",
			code: "c0de",
			clientId: "id",
			clientSecret: "s3cret",
		});
		expect(data.access_token).toBe("tok");
		const [url, init] = fetch.mock.calls[0];
		expect(url).toBe(metadata.token_endpoint);
		expect(init.headers.Authorization).toBe("Basic " + btoa("id:s3cret"));
		expect(init.body).toBe("grant_type=authorization_code&code=c0de&redirect_uri=https%3A%2F%2Fapp%2F");
	});

	it("reports token errors", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" })));
		await expect(
			oauth2.exchangeCode({ serverMetadata: metadata, redirectUri: "x", code: "c", clientId: "id" }),
		).rejects.toThrow("Authentication failed: invalid_grant");
	});

	it("introspects tokens", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ active: true, username: "alice" })));
		await expect(
			oauth2.introspectToken({ serverMetadata: metadata, token: "t", clientId: "id" }),
		).resolves.toMatchObject({ username: "alice" });
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ active: false })));
		await expect(
			oauth2.introspectToken({ serverMetadata: metadata, token: "t", clientId: "id" }),
		).rejects.toThrow("Expired token");
	});
});
