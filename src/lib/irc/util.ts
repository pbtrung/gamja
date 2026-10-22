/** Helpers shared by the IRC modules. */

/** Split a "key=value" token of ISUPPORT or CAP LS, the value may be missing. */
export function splitKeyValue(tok: string): [string, string] {
	const i = tok.indexOf("=");
	return i < 0 ? [tok, ""] : [tok.slice(0, i), tok.slice(i + 1)];
}

const textEncoder = new TextEncoder();

/** Length of a string on the wire, in bytes */
export function byteLength(s: string): number {
	return textEncoder.encode(s).length;
}
