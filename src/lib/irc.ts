import * as base64 from "./base64";

// RFC 1459
export const RPL_WELCOME = "001";
export const RPL_YOURHOST = "002";
export const RPL_CREATED = "003";
export const RPL_MYINFO = "004";
export const RPL_ISUPPORT = "005";
export const RPL_UMODEIS = "221";
export const RPL_TRYAGAIN = "263";
export const RPL_AWAY = "301";
export const RPL_UNAWAY = "305";
export const RPL_NOWAWAY = "306";
export const RPL_WHOISUSER = "311";
export const RPL_WHOISSERVER = "312";
export const RPL_WHOISOPERATOR = "313";
export const RPL_WHOISIDLE = "317";
export const RPL_ENDOFWHOIS = "318";
export const RPL_WHOISCHANNELS = "319";
export const RPL_WHOISACCOUNT = "330";
export const RPL_ENDOFWHO = "315";
export const RPL_LISTSTART = "321";
export const RPL_LIST = "322";
export const RPL_LISTEND = "323";
export const RPL_CHANNELMODEIS = "324";
export const RPL_NOTOPIC = "331";
export const RPL_TOPIC = "332";
export const RPL_TOPICWHOTIME = "333";
export const RPL_INVITING = "341";
export const RPL_INVITELIST = "346";
export const RPL_ENDOFINVITELIST = "347";
export const RPL_EXCEPTLIST = "348";
export const RPL_ENDOFEXCEPTLIST = "349";
export const RPL_WHOREPLY = "352";
export const RPL_NAMREPLY = "353";
export const RPL_WHOSPCRPL = "354";
export const RPL_ENDOFNAMES = "366";
export const RPL_BANLIST = "367";
export const RPL_ENDOFBANLIST = "368";
export const RPL_MOTD = "372";
export const RPL_MOTDSTART = "375";
export const RPL_ENDOFMOTD = "376";
export const ERR_UNKNOWNERROR = "400";
export const ERR_NOSUCHNICK = "401";
export const ERR_NOSUCHCHANNEL = "403";
export const ERR_CANNOTSENDTOCHAN = "404";
export const ERR_TOOMANYCHANNELS = "405";
export const ERR_UNKNOWNCOMMAND = "421";
export const ERR_NOMOTD = "422";
export const ERR_ERRONEUSNICKNAME = "432";
export const ERR_NICKNAMEINUSE = "433";
export const ERR_NICKCOLLISION = "436";
export const ERR_NEEDMOREPARAMS = "461";
export const ERR_NOPERMFORHOST = "463";
export const ERR_PASSWDMISMATCH = "464";
export const ERR_YOUREBANNEDCREEP = "465";
export const ERR_LINKCHANNEL = "470";
export const ERR_CHANNELISFULL = "471";
export const ERR_INVITEONLYCHAN = "473";
export const ERR_BANNEDFROMCHAN = "474";
export const ERR_BADCHANNELKEY = "475";
export const ERR_BADCHANMASK = "476";
export const ERR_NEEDREGGEDNICK = "477";
export const ERR_CHANOPRIVSNEEDED = "482";
// RFC 2812
export const ERR_UNAVAILRESOURCE = "437";
// Other
export const RPL_CHANNEL_URL = "328";
export const RPL_CREATIONTIME = "329";
export const RPL_QUIETLIST = "728";
export const RPL_ENDOFQUIETLIST = "729";
// IRCv3 MONITOR: https://ircv3.net/specs/extensions/monitor
export const RPL_MONONLINE = "730";
// IRCv3 metadata: https://ircv3.net/specs/extensions/metadata
export const RPL_KEYVALUE = "761";
export const RPL_METADATASUBOK = "770";
export const RPL_METADATAUNSUBOK = "771";
export const RPL_MONOFFLINE = "731";
export const RPL_MONLIST = "732";
export const RPL_ENDOFMONLIST = "733";
export const ERR_MONLISTFULL = "734";
// IRCv3 SASL: https://ircv3.net/specs/extensions/sasl-3.1
export const RPL_LOGGEDIN = "900";
export const RPL_LOGGEDOUT = "901";
export const ERR_NICKLOCKED = "902";
export const RPL_SASLSUCCESS = "903";
export const ERR_SASLFAIL = "904";
export const ERR_SASLTOOLONG = "905";
export const ERR_SASLABORTED = "906";
export const ERR_SASLALREADY = "907";

export const STD_MEMBERSHIP_NAMES: Record<string, string> = {
	"~": "owner",
	"&": "admin",
	"@": "operator",
	"%": "halfop",
	"+": "voice",
};

const STD_PREFIX = "(ov)@+";
const STD_CHANTYPES = "#&+!";

export type Tags = Record<string, string | null | undefined>;

export interface Prefix {
	name: string;
	user?: string | null;
	host?: string | null;
}

export interface Batch {
	name: string;
	type: string;
	params: string[];
	tags: Tags;
	parent: Batch | null;
}

/** An IRC message, as parsed from the wire or built for sending. */
export interface Message {
	tags: Tags;
	prefix: Prefix | null;
	command: string;
	params: string[];
	/** Batch the message belongs to, set by the client */
	batch?: Batch | null;
	/** Pending list of replies, set by the client for NAMES/WHO/WHOIS */
	list?: Message[];
	/** Reply to a command sent internally by the client */
	internal?: boolean;
	/** Set by the UI */
	isHighlight?: boolean;
	key?: number;
}

/** A message to send. Tags and prefix are optional. */
export interface OutgoingMessage {
	tags?: Tags;
	prefix?: Prefix | null;
	command: string;
	params?: (string | number)[];
}

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
	const tags: Tags = {};
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
	for (const k in tags) {
		const v = tags[k];
		if (v === undefined || v === null || v === "") {
			l.push(k);
			continue;
		}
		l.push(k + "=" + escapeTag(v));
	}
	return l.join(";");
}

export function parsePrefix(s: string): Prefix {
	let host: string | null = null;
	let i = s.indexOf("@");
	if (i > 0) {
		host = s.slice(i + 1);
		s = s.slice(0, i);
	}

	let user: string | null = null;
	i = s.indexOf("!");
	if (i > 0) {
		user = s.slice(i + 1);
		s = s.slice(0, i);
	}

	return { name: s, user, host };
}

function formatPrefix(prefix: Prefix): string {
	let s = prefix.name;
	if (prefix.user) {
		s += "!" + prefix.user;
	}
	if (prefix.host) {
		s += "@" + prefix.host;
	}
	return s;
}

export function parseMessage(s: string): Message {
	if (s.endsWith("\r\n")) {
		s = s.slice(0, s.length - 2);
	} else if (s.endsWith("\n")) {
		s = s.slice(0, s.length - 1);
	}

	const msg: Message = {
		tags: {},
		prefix: null,
		command: "",
		params: [],
	};

	if (s.startsWith("@")) {
		const i = s.indexOf(" ");
		if (i < 0) {
			throw new Error("expected a space after tags");
		}
		msg.tags = parseTags(s.slice(1, i));
		s = s.slice(i + 1).replace(/^ +/, "");
	}

	if (s.startsWith(":")) {
		const i = s.indexOf(" ");
		if (i < 0) {
			throw new Error("expected a space after prefix");
		}
		msg.prefix = parsePrefix(s.slice(1, i));
		s = s.slice(i + 1).replace(/^ +/, "");
	}

	let i = s.indexOf(" ");
	if (i < 0) {
		msg.command = s;
		if (!msg.command) {
			throw new Error("missing command");
		}
		return msg;
	}
	msg.command = s.slice(0, i);
	s = s.slice(i + 1);

	while (s.length > 0) {
		if (s.startsWith(":")) {
			msg.params.push(s.slice(1));
			break;
		}

		i = s.indexOf(" ");
		if (i < 0) {
			msg.params.push(s);
			break;
		}

		if (i > 0) {
			msg.params.push(s.slice(0, i));
		}
		s = s.slice(i + 1);
	}

	return msg;
}

/** Characters that would end the line or the string early on the wire */
const unsafeLineChars = /[\r\n\0]/;

export function formatMessage(msg: OutgoingMessage): string {
	// Refuse rather than let a crafted value inject another command
	if (unsafeLineChars.test(msg.command) || msg.params?.some((p) => unsafeLineChars.test(String(p)))) {
		throw new Error("IRC message contains a line break or NUL character");
	}
	let s = "";
	if (msg.tags && Object.keys(msg.tags).length > 0) {
		s += "@" + formatTags(msg.tags) + " ";
	}
	if (msg.prefix) {
		s += ":" + formatPrefix(msg.prefix) + " ";
	}
	s += msg.command;
	if (msg.params && msg.params.length > 0) {
		for (let i = 0; i < msg.params.length - 1; i++) {
			s += " " + msg.params[i];
		}

		const last = String(msg.params[msg.params.length - 1]);
		if (last.length === 0 || last.startsWith(":") || last.indexOf(" ") >= 0) {
			s += " :" + last;
		} else {
			s += " " + last;
		}
	}
	return s;
}

/** Split a prefix and a name out of a target. */
export function parseTargetPrefix(s: string, allowedPrefixes: string): { prefix: string; name: string } {
	let i;
	for (i = 0; i < s.length; i++) {
		if (allowedPrefixes.indexOf(s[i]) < 0) {
			break;
		}
	}

	return {
		prefix: s.slice(0, i),
		name: s.slice(i),
	};
}

const alphaNum = /^[\p{L}0-9]$/u;
const space = /^\s$/;

function isWordBoundary(ch: string): boolean {
	switch (ch) {
		case "-":
		case "_":
		case "|":
			return false;
		default:
			return !alphaNum.test(ch);
	}
}

function isURIPrefix(text: string): boolean {
	for (let i = text.length - 1; i >= 0; i--) {
		if (space.test(text[i])) {
			text = text.slice(i);
			break;
		}
	}

	const i = text.indexOf("://");
	if (i <= 0) {
		return false;
	}

	// See RFC 3986 section 3
	const ch = text[i - 1];
	switch (ch) {
		case "+":
		case "-":
		case ".":
			return true;
		default:
			return alphaNum.test(ch);
	}
}

export type CaseMapFn = (s: string) => string;

export function isHighlight(msg: Message, nick: string, cm: CaseMapFn): boolean {
	if (msg.command !== "PRIVMSG" && msg.command !== "NOTICE") {
		return false;
	}

	nick = cm(nick);

	if (msg.prefix && cm(msg.prefix.name) === nick) {
		return false; // Our own messages aren't highlights
	}

	let text = cm(msg.params[1] ?? "");
	while (true) {
		const i = text.indexOf(nick);
		if (i < 0) {
			return false;
		}

		// Detect word boundaries
		let left = "\x00",
			right = "\x00";
		if (i > 0) {
			left = text[i - 1];
		}
		if (i + nick.length < text.length) {
			right = text[i + nick.length];
		}
		if (isWordBoundary(left) && isWordBoundary(right) && !isURIPrefix(text.slice(0, i))) {
			return true;
		}

		text = text.slice(i + nick.length);
	}
}

export function isServerBroadcast(msg: Message): boolean {
	if (msg.command !== "PRIVMSG" && msg.command !== "NOTICE") {
		return false;
	}
	return msg.params[0].startsWith("$");
}

export function isError(cmd: string): boolean {
	if (/^\d{3}$/.test(cmd) && cmd >= "400" && cmd <= "568") {
		return true;
	}
	switch (cmd) {
		case ERR_NICKLOCKED:
		case ERR_SASLFAIL:
		case ERR_SASLTOOLONG:
		case ERR_SASLABORTED:
		case ERR_SASLALREADY:
		case ERR_MONLISTFULL:
		case "FAIL":
			return true;
		default:
			return false;
	}
}

export function formatDate(date: Date): string {
	// ISO 8601 with millisecond precision, as required by server-time
	return date.toISOString();
}

export interface CTCP {
	command: string;
	param: string;
}

export function parseCTCP(msg: Message): CTCP | null {
	if (msg.command !== "PRIVMSG" && msg.command !== "NOTICE") {
		return null;
	}

	let text = msg.params[1] ?? "";
	if (!text.startsWith("\x01")) {
		return null;
	}
	text = text.slice(1);
	if (text.endsWith("\x01")) {
		text = text.slice(0, -1);
	}

	let ctcp: CTCP;
	const i = text.indexOf(" ");
	if (i >= 0) {
		ctcp = { command: text.slice(0, i), param: text.slice(i + 1) };
	} else {
		ctcp = { command: text, param: "" };
	}
	ctcp.command = ctcp.command.toUpperCase();
	return ctcp;
}

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

	parse(tokens: string[]): void {
		for (const tok of tokens) {
			if (tok.startsWith("-")) {
				this.raw.delete(tok.slice(1).toUpperCase());
				continue;
			}

			const i = tok.indexOf("=");
			let k = tok,
				v = "";
			if (i >= 0) {
				k = tok.slice(0, i);
				v = unescapeISUPPORTValue(tok.slice(i + 1));
			}

			this.raw.set(k.toUpperCase(), v);
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

	filehost(): string | undefined {
		return this.raw.get("SOJU.IM/FILEHOST");
	}

	/** VAPID public key for soju.im/webpush */
	vapid(): string | undefined {
		return this.raw.get("VAPID");
	}

	/** Client tags the server refuses to relay, from CLIENTTAGDENY */
	clientTagDeny(): { denyAll: boolean; allowed: Set<string>; denied: Set<string> } {
		const v = this.raw.get("CLIENTTAGDENY");
		const result = { denyAll: false, allowed: new Set<string>(), denied: new Set<string>() };
		if (!v) {
			return result;
		}
		for (const item of v.split(",")) {
			if (item === "*") {
				result.denyAll = true;
			} else if (item.startsWith("-")) {
				result.allowed.add(item.slice(1));
			} else {
				result.denied.add(item);
			}
		}
		return result;
	}
}

/** Check whether the server relays the given client-only tag (without "+"). */
export function isClientTagAllowed(isupport: Isupport, tag: string): boolean {
	const deny = isupport.clientTagDeny();
	if (deny.denyAll) {
		return deny.allowed.has(tag);
	}
	return !deny.denied.has(tag);
}

export function getMaxPrivmsgLen(isupport: Isupport, nick: string, target: string): number {
	const user = "_".repeat(isupport.userLen());
	const host = "_".repeat(isupport.hostLen());
	const prefix = { name: nick, user, host };
	const msg = { prefix, command: "PRIVMSG", params: [target, ""] };
	const raw = formatMessage(msg) + "\r\n";
	return isupport.lineLen() - raw.length;
}

function caseMapWith(table: Record<string, string>): CaseMapFn {
	return (str: string) => {
		let out = "";
		for (const ch of str) {
			if ("A" <= ch && ch <= "Z") {
				out += ch.toLowerCase();
			} else {
				out += table[ch] ?? ch;
			}
		}
		return out;
	};
}

export const CaseMapping = {
	ASCII: caseMapWith({}),
	RFC1459: caseMapWith({ "{": "[", "}": "]", "\\": "|", "~": "^" }),
	RFC1459Strict: caseMapWith({ "{": "[", "}": "]", "\\": "|" }),

	byName(name: string): CaseMapFn | null {
		switch (name) {
			case "ascii":
				return CaseMapping.ASCII;
			case "rfc1459":
				return CaseMapping.RFC1459;
			case "rfc1459-strict":
				return CaseMapping.RFC1459Strict;
		}
		return null;
	},
};

/** A Map with case-insensitive keys, according to an IRC case-mapping. */
export class CaseMapMap<V> implements Iterable<[string, V]> {
	caseMap: CaseMapFn;
	map: Map<string, { key: string; value: V }>;

	constructor(iterable: Iterable<[string, V]> | CaseMapMap<V> | null, cm?: CaseMapFn | null) {
		if (iterable instanceof CaseMapMap && (iterable.caseMap === cm || !cm)) {
			// Fast-path if we're just cloning another CaseMapMap
			this.caseMap = iterable.caseMap;
			this.map = new Map(iterable.map);
		} else {
			if (!cm) {
				throw new Error("Missing case-mapping when creating CaseMapMap");
			}

			this.caseMap = cm;
			this.map = new Map();

			if (iterable) {
				for (const [key, value] of iterable) {
					this.set(key, value);
				}
			}
		}
	}

	get size(): number {
		return this.map.size;
	}

	has(key: string): boolean {
		return this.map.has(this.caseMap(key));
	}

	get(key: string): V | undefined {
		return this.map.get(this.caseMap(key))?.value;
	}

	set(key: string, value: V): this {
		this.map.set(this.caseMap(key), { key, value });
		return this;
	}

	delete(key: string): boolean {
		return this.map.delete(this.caseMap(key));
	}

	*entries(): IterableIterator<[string, V]> {
		for (const kv of this.map.values()) {
			yield [kv.key, kv.value];
		}
	}

	*keys(): IterableIterator<string> {
		for (const kv of this.map.values()) {
			yield kv.key;
		}
	}

	*values(): IterableIterator<V> {
		for (const kv of this.map.values()) {
			yield kv.value;
		}
	}

	[Symbol.iterator](): IterableIterator<[string, V]> {
		return this.entries();
	}
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

export function findBatchByType(msg: Message, type: string): Batch | null {
	let batch = msg.batch;
	while (batch) {
		if (batch.type === type) {
			return batch;
		}
		batch = batch.parent;
	}
	return null;
}

export function getMessageLabel(msg: Message): string | null {
	if (msg.tags.label) {
		return msg.tags.label;
	}

	let batch = msg.batch;
	while (batch) {
		if (batch.tags.label) {
			return batch.tags.label;
		}
		batch = batch.parent;
	}

	return null;
}

export function forEachChannelModeUpdate(
	msg: Message,
	isupport: Isupport,
	callback: (mode: string, add: boolean, arg: string | null) => void,
): void {
	const [a, b, c, d] = isupport.chanModes();
	const membershipModes = isupport.membershipModes();

	const typeByMode = new Map<string, string>();
	Array.from(a).forEach((mode) => typeByMode.set(mode, "A"));
	Array.from(b).forEach((mode) => typeByMode.set(mode, "B"));
	Array.from(c).forEach((mode) => typeByMode.set(mode, "C"));
	Array.from(d).forEach((mode) => typeByMode.set(mode, "D"));
	membershipModes.forEach((membership) => typeByMode.set(membership.mode, "B"));

	if (msg.command !== "MODE") {
		throw new Error("Expected a MODE message");
	}
	const change = msg.params[1];
	const args = msg.params.slice(2);

	let plusMinus: string | null = null;
	let j = 0;
	for (let i = 0; i < change.length; i++) {
		if (change[i] === "+" || change[i] === "-") {
			plusMinus = change[i];
			continue;
		}
		if (!plusMinus) {
			throw new Error("malformed mode string: missing plus/minus");
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

/**
 * Check if a realname is worth displaying.
 *
 * Since the realname is mandatory, many clients set a meaningless realname.
 */
export function isMeaningfulRealname(realname: string | null | undefined, nick: string): boolean {
	if (!realname || realname === nick) {
		return false;
	}

	const lower = realname.toLowerCase();
	if (lower === "realname" || lower === "unknown" || lower === "fullname") {
		return false;
	}

	return true;
}

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

export class CapRegistry {
	available = new Map<string, string>();
	enabled = new Set<string>();

	addAvailable(s: string): void {
		for (const item of s.split(" ")) {
			if (!item) {
				continue;
			}
			const i = item.indexOf("=");
			let k = item,
				v = "";
			if (i >= 0) {
				k = item.slice(0, i);
				v = item.slice(i + 1);
			}
			this.available.set(k.toLowerCase(), v);
		}
	}

	parse(msg: Message): void {
		if (msg.command !== "CAP") {
			return;
		}

		const subCmd = msg.params[1];
		const args = msg.params.slice(2);
		switch (subCmd) {
			case "LS":
				this.addAvailable(args[args.length - 1]);
				break;
			case "NEW":
				this.addAvailable(args[0]);
				break;
			case "DEL":
				for (let cap of args[0].split(" ")) {
					cap = cap.toLowerCase();
					this.available.delete(cap);
					this.enabled.delete(cap);
				}
				break;
			case "ACK":
				for (let cap of args[0].split(" ")) {
					cap = cap.toLowerCase();
					if (!cap) {
						continue;
					}
					if (cap.startsWith("-")) {
						this.enabled.delete(cap.slice(1));
					} else {
						this.enabled.add(cap);
					}
				}
				break;
		}
	}

	/**
	 * CAP REQ messages for the available caps not enabled yet. A REQ is all or
	 * nothing: sasl gets its own so that another rejected cap can't take it
	 * down, and long lists are split to stay well below the line length.
	 */
	requestAvailable(l: string[]): OutgoingMessage[] {
		l = l.filter((cap) => {
			return this.available.has(cap) && !this.enabled.has(cap);
		});

		const groups: string[][] = [];
		if (l.includes("sasl")) {
			groups.push(["sasl"]);
			l = l.filter((cap) => cap !== "sasl");
		}
		let group: string[] = [];
		let len = 0;
		for (const cap of l) {
			if (group.length > 0 && len + cap.length + 1 > maxCapReqLength) {
				groups.push(group);
				group = [];
				len = 0;
			}
			group.push(cap);
			len += cap.length + 1;
		}
		if (group.length > 0) {
			groups.push(group);
		}
		return groups.map((caps) => ({ command: "CAP", params: ["REQ", caps.join(" ")] }));
	}
}

const maxSASLLength = 400;
const maxCapReqLength = 400;

export function generateAuthenticateMessages(payload: string): OutgoingMessage[] {
	const encoded = base64.encode(payload);

	// <= instead of < because we need to send a final empty response if the
	// last chunk is exactly 400 bytes long
	const msgs: OutgoingMessage[] = [];
	for (let i = 0; i <= encoded.length; i += maxSASLLength) {
		const chunk = encoded.substring(i, i + maxSASLLength);
		msgs.push({ command: "AUTHENTICATE", params: [chunk || "+"] });
	}

	return msgs;
}
