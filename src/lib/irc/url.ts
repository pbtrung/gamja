/** irc:// URLs. */

export interface IRCURL {
	host: string;
	enttype?: "user" | "channel";
	entity: string;
}

/* Parse an irc:// URL.
 *
 * See: https://datatracker.ietf.org/doc/html/draft-butcher-irc-url-04
 */
export function parseURL(str: string): IRCURL | null {
	if (!str.startsWith("irc://") && !str.startsWith("ircs://")) {
		return null;
	}

	str = str.slice(str.indexOf(":") + "://".length);

	let loc;
	let i = str.indexOf("/");
	if (i < 0) {
		loc = str;
		str = "";
	} else {
		loc = str.slice(0, i);
		str = str.slice(i + 1);
	}

	let host = loc;
	i = loc.indexOf("@");
	if (i >= 0) {
		host = loc.slice(i + 1);
	}

	i = str.indexOf("?");
	if (i >= 0) {
		str = str.slice(0, i);
	}

	let enttype: "user" | "channel" | undefined;
	i = str.indexOf(",");
	if (i >= 0) {
		const flags = str.slice(i + 1).split(",");
		str = str.slice(0, i);

		if (flags.indexOf("isuser") >= 0) {
			enttype = "user";
		} else if (flags.indexOf("ischannel") >= 0) {
			enttype = "channel";
		}
	}

	let entity;
	try {
		entity = decodeURIComponent(str);
	} catch (_err) {
		return null; // Invalid percent-encoding
	}
	// eslint-disable-next-line no-control-regex
	if (/[\x00-\x1f\x7f]/.test(entity)) {
		return null; // Control characters can't appear in a channel or nick
	}
	if (!enttype) {
		// TODO: technically we should use the PREFIX ISUPPORT here
		enttype = entity.startsWith("#") ? "channel" : "user";
	}

	return { host, enttype, entity };
}

export function formatURL({ host, enttype, entity }: Partial<IRCURL> = {}): string {
	host = host || "";
	entity = entity || "";

	let s = "irc://" + host + "/" + encodeURIComponent(entity);
	if (enttype) {
		s += ",is" + enttype;
	}
	return s;
}
