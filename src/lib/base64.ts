/** Base64-encode a string as UTF-8 (btoa() only handles Latin-1). */
export function encode(data: string): string {
	const bytes = new TextEncoder().encode(data);
	let binary = "";
	for (const b of bytes) {
		binary += String.fromCharCode(b);
	}
	return btoa(binary);
}

/** Base64url-decode into bytes, e.g. a VAPID public key. */
export function decodeURL(s: string): Uint8Array<ArrayBuffer> {
	s = s.replace(/-/g, "+").replace(/_/g, "/");
	s += "=".repeat((4 - (s.length % 4)) % 4);
	const binary = atob(s);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/** Base64url-encode bytes without padding. */
export function encodeURL(buf: ArrayBuffer | null): string {
	if (!buf) {
		return "";
	}
	let binary = "";
	for (const b of new Uint8Array(buf)) {
		binary += String.fromCharCode(b);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
