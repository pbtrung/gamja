/** ISUPPORT tokens, membership and channel modes. */

import { CaseMapping, type CaseMapFn } from "./casemapping";
import type { Message } from "./message";
import { splitKeyValue } from "./util";

export const STD_MEMBERSHIP_NAMES: Record<string, string> = {
	"~": "owner",
	"&": "admin",
	"@": "operator",
	"%": "halfop",
	"+": "voice",
};

const STD_PREFIX = "(ov)@+";

const STD_CHANTYPES = "#&+!";

function unescapeISUPPORTValue(s: string): string {
	return s.replace(/\\x[0-9A-F]{2}/gi, (esc) => {
		const hex = esc.slice(2);
		return String.fromCharCode(parseInt(hex, 16));
	});
}

export interface MembershipMode {
	mode: string;
	prefix: string;
}

export class Isupport {
	raw = new Map<string, string>();
	/** Values derived from raw, dropped when it changes */
	private cache: {
		clientTagDeny?: ClientTagDeny;
		channelModeTypes?: ReadonlyMap<string, string>;
	} = {};

	parse(tokens: string[]): void {
		this.cache = {};
		for (const tok of tokens) {
			if (tok.startsWith("-")) {
				this.raw.delete(tok.slice(1).toUpperCase());
				continue;
			}

			const [k, v] = splitKeyValue(tok);
			this.raw.set(k.toUpperCase(), unescapeISUPPORTValue(v));
		}
	}

	caseMapping(): CaseMapFn {
		const name = this.raw.get("CASEMAPPING");
		if (!name) {
			return CaseMapping.RFC1459;
		}
		const cm = CaseMapping.byName(name);
		if (!cm) {
			console.error("Unsupported case-mapping '" + name + "', falling back to RFC 1459");
			return CaseMapping.RFC1459;
		}
		return cm;
	}

	monitor(): number {
		const v = this.raw.get("MONITOR");
		if (v === undefined) {
			return 0;
		} else if (v === "") {
			return Infinity;
		}
		return parseInt(v, 10);
	}

	/** Maximum number of targets of a command, from TARGMAX */
	targMax(cmd: string): number {
		const v = this.raw.get("TARGMAX");
		if (!v) {
			return Infinity;
		}
		cmd = cmd.toUpperCase();
		for (const item of v.split(",")) {
			const i = item.indexOf(":");
			const k = i < 0 ? item : item.slice(0, i);
			if (k.toUpperCase() !== cmd) {
				continue;
			}
			// An empty limit means there is none
			const n = parseInt(item.slice(i + 1), 10);
			return n > 0 ? n : Infinity;
		}
		return Infinity;
	}

	whox(): boolean {
		return this.raw.has("WHOX");
	}

	membershipModes(): MembershipMode[] {
		const prefix = this.raw.get("PREFIX");
		return parseMembershipModes(prefix !== undefined ? prefix : STD_PREFIX);
	}

	chanTypes(): string {
		const chanTypes = this.raw.get("CHANTYPES");
		return chanTypes !== undefined ? chanTypes : STD_CHANTYPES;
	}

	statusMsg(): string {
		return this.raw.get("STATUSMSG") || "";
	}

	network(): string | undefined {
		return this.raw.get("NETWORK");
	}

	/** Message reference types accepted by CHATHISTORY, e.g. "timestamp" or "msgid" */
	msgRefTypes(): string[] {
		const v = this.raw.get("MSGREFTYPES");
		// Without the token, only timestamps are safe to assume
		return v ? v.split(",") : ["timestamp"];
	}

	chatHistory(): number {
		const v = this.raw.get("CHATHISTORY");
		if (v === undefined) {
			return 0;
		}
		const n = parseInt(v, 10);
		if (!(n > 0)) {
			return Infinity;
		}
		return n;
	}

	bouncerNetID(): string | undefined {
		return this.raw.get("BOUNCER_NETID");
	}

	chanModes(): [string, string, string, string] {
		const stdChanModes: [string, string, string, string] = ["beI", "k", "l", "imnst"];
		const v = this.raw.get("CHANMODES");
		if (v === undefined) {
			return stdChanModes;
		}
		const chanModes = v.split(",");
		if (chanModes.length < 4) {
			console.error("Invalid CHANMODES: ", v);
			return stdChanModes;
		}
		return [chanModes[0], chanModes[1], chanModes[2], chanModes[3]];
	}

	bot(): string | undefined {
		return this.raw.get("BOT");
	}

	/** Build a ban mask matching an account, null if unsupported (account-extban). */
	accountExtban(account: string): string | null {
		const names = this.raw.get("ACCOUNTEXTBAN");
		const extban = this.raw.get("EXTBAN");
		if (!names || extban === undefined) {
			return null;
		}
		// EXTBAN=<prefix>,<types>, the prefix may be empty
		const prefix = extban.split(",")[0];
		return prefix + names.split(",")[0] + ":" + account;
	}

	private int(key: string, def: number): number {
		const v = this.raw.get(key);
		if (v === undefined || v === "") {
			return def;
		}
		const n = parseInt(v, 10);
		return Number.isNaN(n) ? def : n;
	}

	userLen(): number {
		return this.int("USERLEN", 20);
	}

	hostLen(): number {
		return this.int("HOSTLEN", 63);
	}

	lineLen(): number {
		return this.int("LINELEN", 512);
	}

	/** VAPID public key for soju.im/webpush */
	vapid(): string | undefined {
		return this.raw.get("VAPID");
	}

	/** Client tags the server refuses to relay, from CLIENTTAGDENY */
	clientTagDeny(): ClientTagDeny {
		if (this.cache.clientTagDeny) {
			return this.cache.clientTagDeny;
		}
		const v = this.raw.get("CLIENTTAGDENY");
		const result = { denyAll: false, allowed: new Set<string>(), denied: new Set<string>() };
		for (const item of v ? v.split(",") : []) {
			if (item === "*") {
				result.denyAll = true;
			} else if (item.startsWith("-")) {
				result.allowed.add(item.slice(1));
			} else {
				result.denied.add(item);
			}
		}
		this.cache.clientTagDeny = result;
		return result;
	}

	/** The type of each channel mode, "A" to "D" as in CHANMODES, membership modes are "B". */
	channelModeTypes(): ReadonlyMap<string, string> {
		if (this.cache.channelModeTypes) {
			return this.cache.channelModeTypes;
		}
		const typeByMode = new Map<string, string>();
		const types = ["A", "B", "C", "D"];
		this.chanModes().forEach((modes, i) => {
			for (const mode of modes) {
				typeByMode.set(mode, types[i]);
			}
		});
		for (const membership of this.membershipModes()) {
			typeByMode.set(membership.mode, "B");
		}
		this.cache.channelModeTypes = typeByMode;
		return typeByMode;
	}
}

interface ClientTagDeny {
	denyAll: boolean;
	allowed: ReadonlySet<string>;
	denied: ReadonlySet<string>;
}

/** Check whether the server relays the given client-only tag (without "+"). */
export function isClientTagAllowed(isupport: Isupport, tag: string): boolean {
	const deny = isupport.clientTagDeny();
	if (deny.denyAll) {
		return deny.allowed.has(tag);
	}
	return !deny.denied.has(tag);
}

/** Parse the ISUPPORT PREFIX token */
function parseMembershipModes(str: string): MembershipMode[] {
	if (str === "") {
		return [];
	}
	if (str[0] !== "(") {
		throw new Error("malformed ISUPPORT PREFIX value: expected opening parenthesis");
	}

	const sep = str.indexOf(")");
	if (sep < 0) {
		throw new Error("malformed ISUPPORT PREFIX value: expected closing parenthesis");
	}

	// Ignore unpaired modes or prefixes in a malformed value
	const n = Math.min(sep - 1, str.length - sep - 1);
	const memberships: MembershipMode[] = [];
	for (let i = 0; i < n; i++) {
		const mode = str[i + 1];
		const prefix = str[sep + i + 1];
		memberships.push({ mode, prefix });
	}
	return memberships;
}

export function forEachChannelModeUpdate(
	msg: Message,
	isupport: Isupport,
	callback: (mode: string, add: boolean, arg: string | null) => void,
): void {
	const typeByMode = isupport.channelModeTypes();

	if (msg.command !== "MODE") {
		throw new Error("Expected a MODE message");
	}
	// A MODE without a mode string only queries the modes
	const change = msg.params[1] ?? "";
	const args = msg.params.slice(2);

	let plusMinus: string | null = null;
	let j = 0;
	for (let i = 0; i < change.length; i++) {
		if (change[i] === "+" || change[i] === "-") {
			plusMinus = change[i];
			continue;
		}
		if (!plusMinus) {
			// Malformed: skip the modes before the first sign rather than
			// failing the whole message
			continue;
		}

		const mode = change[i];
		const add = plusMinus === "+";

		const modeType = typeByMode.get(mode);
		if (!modeType) {
			continue;
		}

		let arg: string | null = null;
		if (modeType === "A" || modeType === "B" || (modeType === "C" && add)) {
			arg = args[j] ?? null;
			j++;
		}

		callback(mode, add, arg);
	}
}
