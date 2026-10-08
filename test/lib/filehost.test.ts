import { describe, expect, it, vi } from "vitest";
import { uploadFile } from "../../src/lib/filehost";
import type Client from "../../src/lib/client";
import * as irc from "../../src/lib/irc";

function client(params: Partial<Client["params"]> = {}, filehost = "https://up.example/upload") {
	const isupport = new irc.Isupport();
	if (filehost) {
		isupport.parse([`SOJU.IM/FILEHOST=${filehost}`]);
	}
	return { isupport, params } as unknown as Client;
}

describe("filehost uploads", () => {
	it("uploads with credentials and resolves the location", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(new Response(null, { status: 201, headers: { Location: "/files/abc" } }));
		vi.stubGlobal("fetch", fetch);
		const file = new File(["data"], "héllo world.txt", { type: "text/plain" });
		const url = await uploadFile(client({ saslPlain: { username: "me", password: "pw" } }), file);
		expect(url.toString()).toBe("https://up.example/files/abc");
		const [endpoint, init] = fetch.mock.calls[0];
		expect(endpoint).toBe("https://up.example/upload");
		expect(init.method).toBe("POST");
		expect(init.headers).toEqual({
			"Content-Disposition": "attachment; filename*=UTF-8''h%C3%A9llo%20world.txt",
			"Content-Type": "text/plain",
			Authorization: "Basic " + btoa("me:pw"),
		});
	});

	it("uses bearer tokens and plain filenames", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(new Response(null, { status: 201, headers: { Location: "https://cdn/x" } }));
		vi.stubGlobal("fetch", fetch);
		await uploadFile(client({ saslOauthBearer: { token: "tok" } }), new File(["x"], "a.png"));
		expect(fetch.mock.calls[0][1].headers).toEqual({
			"Content-Disposition": 'attachment; filename="a.png"',
			Authorization: "Bearer tok",
		});
	});

	it("reports errors", async () => {
		await expect(uploadFile(client({}, ""), new File([], "x"))).rejects.toThrow(
			"doesn't support file uploads",
		);
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 413 })));
		await expect(uploadFile(client(), new File([], "x"))).rejects.toThrow("HTTP request failed (413)");
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 201 })));
		await expect(uploadFile(client(), new File([], "x"))).rejects.toThrow("missing Location");
	});
});
