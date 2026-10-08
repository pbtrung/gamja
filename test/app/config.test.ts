import { describe, expect, it, vi } from "vitest";
import {
	fetchConfig,
	formatWindowHash,
	parseWindowHash,
	randomNick,
	resolveServerURL,
	splitHostPort,
} from "../../src/app/config";

describe("config helpers", () => {
	it("resolves server URLs", () => {
		const loc = { host: "chat.example", protocol: "https:", pathname: "/irc/index.html" };
		expect(resolveServerURL(null, loc)).toBe("wss://chat.example/irc/socket");
		expect(resolveServerURL("/ws", loc)).toBe("wss://chat.example/ws");
		expect(resolveServerURL("irc.example:8080/ws", loc)).toBe("wss://irc.example:8080/ws");
		expect(resolveServerURL("ws://x", loc)).toBe("ws://x");
		expect(resolveServerURL(null, { host: "", protocol: "file:", pathname: "/a/b" })).toBe(
			"ws://localhost:8080/socket",
		);
		expect(resolveServerURL(null, { host: "h", protocol: "http:", pathname: "/" })).toBe("ws://h/socket");
	});

	it("splits hosts and ports", () => {
		expect(splitHostPort("irc.example:6697")).toEqual({ host: "irc.example", port: 6697 });
		expect(splitHostPort("irc.example")).toEqual({ host: "irc.example", port: null });
		expect(splitHostPort("[::1]:6697")).toEqual({ host: "::1", port: 6697 });
		expect(splitHostPort("[::1]")).toEqual({ host: "::1", port: null });
	});

	it("parses and formats window hashes", () => {
		const cases: [string | null | undefined, string | null, string][] = [
			[null, null, "#/"],
			[null, "#chan", "#/#chan"],
			["irc.libera.chat", null, "#//irc.libera.chat"],
			["irc.libera.chat", "#soju", "#//irc.libera.chat/#soju"],
			[null, "/weird", "#////weird"],
		];
		for (const [host, entity, hash] of cases) {
			expect(formatWindowHash(host, entity)).toBe(hash);
			expect(parseWindowHash(hash)).toEqual({
				host: host ?? (hash.startsWith("#//") ? "" : undefined),
				entity: entity ?? "",
			});
		}
		expect(parseWindowHash("#/#chan")).toEqual({ host: undefined, entity: "#chan" });
		expect(parseWindowHash("#//irc.libera.chat/%23soju")).toEqual({
			host: "irc.libera.chat",
			entity: "#soju",
		});
		expect(parseWindowHash("#//irc.libera.chat")).toEqual({ host: "irc.libera.chat", entity: "" });
		expect(parseWindowHash("#/%E0%A4%A")).toEqual({ host: undefined, entity: "%E0%A4%A" });
	});

	it("generates random nicks", () => {
		expect(randomNick("guest-*")).toMatch(/^guest-[a-z0-9]{1,7}$/);
	});

	it("fetches config.json", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(JSON.stringify({ server: { url: "wss://x" } }))),
		);
		await expect(fetchConfig()).resolves.toEqual({ server: { url: "wss://x" } });
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
		await expect(fetchConfig()).resolves.toEqual({ server: {} });
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
		await expect(fetchConfig()).resolves.toEqual({ server: {} });
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
		await expect(fetchConfig()).resolves.toEqual({ server: {} });
		expect(err).toHaveBeenCalledTimes(2);
	});
});
