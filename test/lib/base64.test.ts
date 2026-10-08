import { describe, expect, it } from "vitest";
import { decodeURL, encode, encodeURL } from "../../src/lib/base64";

describe("base64", () => {
	it("encodes UTF-8", () => {
		expect(encode("")).toBe("");
		expect(encode("a")).toBe("YQ==");
		expect(encode("\0user\0pass")).toBe("AHVzZXIAcGFzcw==");
		expect(encode("héllo ✓")).toBe(Buffer.from("héllo ✓").toString("base64"));
	});

	it("round-trips base64url", () => {
		const bytes = new Uint8Array([0, 251, 255, 62, 63, 1]);
		const s = encodeURL(bytes.buffer);
		expect(s).not.toMatch(/[+/=]/);
		expect([...decodeURL(s)]).toEqual([...bytes]);
		expect(encodeURL(null)).toBe("");
	});
});
