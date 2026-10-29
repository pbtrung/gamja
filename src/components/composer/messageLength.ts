import { splitMultiline, type MultilineLimits } from "../../lib/irc";

/** Whether the composer text is too long to be sent */
export function isTooLong(text: string, maxLen?: number, multiline?: MultilineLimits | null): boolean {
	// Commands aren't sent as is ("//" escapes a message starting with "/")
	const isCommand = text.startsWith("/") && !text.startsWith("//");
	if (isCommand) {
		return false;
	}
	if (multiline && text.includes("\n")) {
		// Each line is limited by the server's multiline limits instead
		const bytes = new TextEncoder().encode(text.replace(/\n/g, "")).length;
		const lines = splitMultiline(text, maxLen ?? Infinity).length;
		return bytes > multiline.maxBytes || lines > multiline.maxLines;
	}
	if (maxLen !== undefined) {
		return new TextEncoder().encode(text).length > maxLen;
	}
	return false;
}
