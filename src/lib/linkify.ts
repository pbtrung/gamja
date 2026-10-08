import * as linkifyjs from "linkifyjs";

linkifyjs.options.defaults.defaultProtocol = "https";

linkifyjs.registerCustomProtocol("irc");
linkifyjs.registerCustomProtocol("ircs");
linkifyjs.registerCustomProtocol("geo", true);

const IRCChannelToken = linkifyjs.createTokenClass("ircChannel", {
	isLink: true,
	toHref() {
		return "irc:///" + encodeURIComponent((this as unknown as { v: string }).v);
	},
});

linkifyjs.registerPlugin("ircChannel", ({ scanner, parser }) => {
	const { POUND, UNDERSCORE, DOT, HYPHEN } = scanner.tokens;
	const { alphanumeric } = scanner.tokens.groups;

	// The linkifyjs typings don't model token classes in states
	type AnyState = { tt(t: unknown, next?: unknown): AnyState; ta(t: unknown, next: unknown): AnyState };
	const Prefix = parser.start.tt(POUND) as unknown as AnyState;
	const Channel = new linkifyjs.State(IRCChannelToken) as unknown as AnyState;
	const Divider = Channel.tt(DOT);

	Prefix.ta(alphanumeric, Channel);
	Prefix.tt(POUND, Channel);
	Prefix.tt(UNDERSCORE, Channel);
	Prefix.tt(DOT, Divider);
	Prefix.tt(HYPHEN, Channel);
	Channel.ta(alphanumeric, Channel);
	Channel.tt(POUND, Channel);
	Channel.tt(UNDERSCORE, Channel);
	Channel.tt(HYPHEN, Channel);
	Divider.ta(alphanumeric, Channel);
});

export type LinkSegment = { text: string; href?: undefined } | { text: string; href: string; type: string };

/** Split text into plain text and link segments. */
export function findLinks(text: string): LinkSegment[] {
	const links = linkifyjs.find(text);

	const segments: LinkSegment[] = [];
	let last = 0;
	for (const match of links) {
		if (!match.isLink) {
			continue;
		}
		if (match.start > last) {
			segments.push({ text: text.substring(last, match.start) });
		}
		segments.push({ text: match.value, href: match.href, type: match.type });
		last = match.end;
	}
	if (last < text.length) {
		segments.push({ text: text.substring(last) });
	}
	return segments;
}
