/** IRCv3 message tags and their wire escaping. */

export type Tags = Record<string, string | null | undefined>;

const tagEscapeMap: Record<string, string> = {
	";": "\\:",
	" ": "\\s",
	"\\": "\\\\",
	"\r": "\\r",
	"\n": "\\n",
};

const tagUnescapeMap = Object.fromEntries(Object.entries(tagEscapeMap).map(([from, to]) => [to, from]));

function escapeTag(s: string): string {
	return String(s).replace(/[; \\\r\n]/g, (ch) => tagEscapeMap[ch]);
}

function unescapeTag(s: string): string {
	return s.replace(/\\[:s\\rn]?/g, (seq) => tagUnescapeMap[seq] ?? "");
}

export function parseTags(s: string): Tags {
	const tags: Tags = Object.create(null) as Tags;
	for (const item of s.split(";")) {
		if (!item) {
			continue;
		}
		const i = item.indexOf("=");
		if (i < 0) {
			tags[item] = null;
		} else {
			tags[item.slice(0, i)] = unescapeTag(item.slice(i + 1));
		}
	}
	return tags;
}

export function formatTags(tags: Tags): string {
	const l: string[] = [];
	for (const [key, value] of Object.entries(tags)) {
		let k = key;
		const v = value?.replace(/\0/g, "");
		// Escaping can't help in keys
		k = k.replace(/[\0\r\n]/g, "");
		if (/[= ;]/.test(k)) {
			throw new Error(`Invalid IRC tag key "${k}"`);
		}
		if (v === undefined || v === null || v === "") {
			l.push(k);
			continue;
		}
		l.push(k + "=" + escapeTag(v));
	}
	return l.join(";");
}
