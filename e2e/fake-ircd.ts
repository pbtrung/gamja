/**
 * A small in-memory IRC server speaking over WebSocket, implementing the
 * subset of IRCv3 and soju extensions gamja uses. Used by the end-to-end
 * tests, and handy for local development:
 *
 *     node e2e/fake-ircd.ts 8081
 *     open http://localhost:8080/?server=ws://localhost:8081
 */
import { WebSocketServer, type WebSocket } from "ws";

const SERVER_NAME = "irc.fake.test";
const NETWORK = "FakeNet";

interface Msg {
	tags: Record<string, string>;
	prefix?: string;
	command: string;
	params: string[];
}

function escapeTag(v: string): string {
	return v.replace(
		/[\\; \r\n]/g,
		(c) => ({ "\\": "\\\\", ";": "\\:", " ": "\\s", "\r": "\\r", "\n": "\\n" })[c]!,
	);
}

function unescapeTag(v: string): string {
	return v.replace(
		/\\[:s\\rn]?/g,
		(s) => ({ "\\:": ";", "\\s": " ", "\\\\": "\\", "\\r": "\r", "\\n": "\n" })[s] ?? "",
	);
}

export function parse(line: string): Msg {
	const msg: Msg = { tags: {}, command: "", params: [] };
	if (line.startsWith("@")) {
		const i = line.indexOf(" ");
		for (const kv of line.slice(1, i).split(";")) {
			const j = kv.indexOf("=");
			if (j < 0) {
				msg.tags[kv] = "";
			} else {
				msg.tags[kv.slice(0, j)] = unescapeTag(kv.slice(j + 1));
			}
		}
		line = line.slice(i + 1);
	}
	if (line.startsWith(":")) {
		const i = line.indexOf(" ");
		msg.prefix = line.slice(1, i);
		line = line.slice(i + 1);
	}
	const i = line.indexOf(" :");
	let trailing: string | null = null;
	if (i >= 0) {
		trailing = line.slice(i + 2);
		line = line.slice(0, i);
	}
	const parts = line.split(" ").filter(Boolean);
	msg.command = (parts.shift() || "").toUpperCase();
	msg.params = parts;
	if (trailing !== null) {
		msg.params.push(trailing);
	}
	return msg;
}

export function format(msg: Msg): string {
	let s = "";
	const tags = Object.entries(msg.tags);
	if (tags.length > 0) {
		s += "@" + tags.map(([k, v]) => (v ? `${k}=${escapeTag(v)}` : k)).join(";") + " ";
	}
	if (msg.prefix) {
		s += ":" + msg.prefix + " ";
	}
	s += msg.command;
	msg.params.forEach((p, i) => {
		if (i === msg.params.length - 1 && (p === "" || p.includes(" ") || p.startsWith(":"))) {
			s += " :" + p;
		} else {
			s += " " + p;
		}
	});
	return s;
}

const cm = (s: string) =>
	s.toLowerCase().replace(/[[\]\\~]/g, (c) => ({ "[": "{", "]": "}", "\\": "|", "~": "^" })[c]!);

interface HistoryEntry {
	time: string;
	msgid: string;
	prefix: string;
	command: string;
	params: string[];
	tags: Record<string, string>;
}

interface Channel {
	name: string;
	topic: string;
	members: Map<string, string>; // cm(nick) → prefix
}

export interface ServerOptions {
	port: number;
	/** Accounts accepted by SASL PLAIN */
	accounts?: Record<string, string>;
	/** Advertise soju.im/bouncer-networks */
	bouncer?: boolean;
	/** Advertise soju.im/FILEHOST */
	filehost?: string;
}

let msgidCounter = 0;
let lastTime = 0;

function now(): string {
	// Strictly increasing timestamps keep history ordering deterministic
	let t = Date.now();
	if (t <= lastTime) {
		t = lastTime + 1;
	}
	lastTime = t;
	return new Date(t).toISOString();
}

const AVAILABLE_CAPS = [
	"account-notify",
	"account-tag",
	"away-notify",
	"batch",
	"chghost",
	"echo-message",
	"extended-join",
	"extended-monitor",
	"invite-notify",
	"labeled-response",
	"message-tags",
	"multi-prefix",
	"sasl=PLAIN",
	"server-time",
	"setname",
	"draft/chathistory",
	"draft/event-playback",
	"draft/read-marker",
	"draft/message-redaction",
	"draft/account-registration=before-connect",
	"soju.im/no-implicit-names",
	"soju.im/search",
	"soju.im/webpush",
	"userhost-in-names",
];

class Conn {
	ws: WebSocket;
	server: FakeServer;
	nick = "*";
	user = "";
	realname = "";
	account: string | null = null;
	away: string | null = null;
	caps = new Set<string>();
	capNegotiating = false;
	registered = false;
	saslPayload: string | null = null;
	saslMechanism: string | null = null;
	monitored = new Set<string>();
	bouncerNetwork: string | null = null;
	lines: string[] = [];

	constructor(ws: WebSocket, server: FakeServer) {
		this.ws = ws;
		this.server = server;
	}

	get prefix(): string {
		return `${this.nick}!${this.user || "user"}@fake.host`;
	}

	send(msg: Msg, opts: { time?: string } = {}): void {
		const tags: Record<string, string> = {};
		for (const [k, v] of Object.entries(msg.tags)) {
			if (k.startsWith("+") || k === "msgid" || k === "batch" || k === "label") {
				if (this.caps.has("message-tags") || k === "batch" || k === "label") {
					tags[k] = v;
				}
			} else if (k === "time") {
				// handled below
			} else if (k === "account") {
				if (this.caps.has("account-tag")) {
					tags[k] = v;
				}
			} else {
				tags[k] = v;
			}
		}
		if (this.caps.has("server-time")) {
			tags.time = msg.tags.time || opts.time || now();
		}
		const line = format({ ...msg, tags, prefix: msg.prefix ?? SERVER_NAME });
		this.lines.push(line);
		if (this.ws.readyState === this.ws.OPEN) {
			this.ws.send(line);
		}
	}

	numeric(code: string, ...params: string[]): void {
		this.send({ tags: {}, command: code, params: [this.nick, ...params] });
	}
}

export class FakeServer {
	wss: WebSocketServer;
	opts: ServerOptions;
	conns = new Set<Conn>();
	channels = new Map<string, Channel>();
	history = new Map<string, HistoryEntry[]>(); // cm(target) → entries
	readMarkers = new Map<string, string>(); // account/nick + target → timestamp
	webpush = new Map<string, boolean>(); // endpoint → registered
	networks = new Map<string, Record<string, string>>([
		["1", { name: NETWORK, host: "irc.fake.test", state: "connected" }],
	]);

	constructor(opts: ServerOptions) {
		this.opts = opts;
		this.wss = new WebSocketServer({ port: opts.port });
		this.wss.on("connection", (ws) => this.handleConnection(ws));
	}

	get port(): number {
		const addr = this.wss.address();
		return typeof addr === "object" && addr ? addr.port : this.opts.port;
	}

	close(): Promise<void> {
		for (const c of this.conns) {
			c.ws.terminate();
		}
		return new Promise((resolve) => this.wss.close(() => resolve()));
	}

	handleConnection(ws: WebSocket): void {
		const conn = new Conn(ws, this);
		this.conns.add(conn);
		ws.on("message", (data) => {
			for (const line of data.toString().split(/\r?\n/)) {
				if (!line) {
					continue;
				}
				try {
					this.handle(conn, parse(line));
				} catch (err) {
					console.error("fake-ircd: failed to handle", line, err);
				}
			}
		});
		ws.on("close", () => {
			this.conns.delete(conn);
			if (conn.registered) {
				this.quit(conn, "Connection closed");
			}
		});
	}

	/** In bouncer mode, connections not bound to a network only manage networks. */
	isRoot(c: Conn): boolean {
		return Boolean(this.opts.bouncer) && !c.bouncerNetwork;
	}

	findConn(nick: string): Conn | undefined {
		for (const c of this.conns) {
			if (c.registered && cm(c.nick) === cm(nick) && !this.isRoot(c)) {
				return c;
			}
		}
		return undefined;
	}

	connsFor(nick: string): Conn[] {
		return [...this.conns].filter((c) => c.registered && cm(c.nick) === cm(nick) && !this.isRoot(c));
	}

	caps(): string[] {
		const caps = [...AVAILABLE_CAPS];
		if (this.opts.bouncer) {
			caps.push("soju.im/bouncer-networks", "soju.im/bouncer-networks-notify");
		}
		return caps;
	}

	handle(conn: Conn, msg: Msg): void {
		const label = msg.tags.label;
		const reply = (m: Omit<Msg, "tags"> & { tags?: Record<string, string> }) => {
			const tags = { ...m.tags };
			if (label && conn.caps.has("labeled-response")) {
				tags.label = label;
			}
			conn.send({ ...m, tags });
		};

		switch (msg.command) {
			case "CAP":
				return this.handleCap(conn, msg);
			case "PASS":
				return;
			case "AUTHENTICATE":
				return this.handleAuthenticate(conn, msg);
			case "NICK": {
				const nick = msg.params[0];
				if (!conn.registered) {
					// A bouncer lets several clients share a nick
					if (!this.opts.bouncer && this.findConn(nick)) {
						conn.send({
							tags: {},
							command: "433",
							params: ["*", nick, "Nickname is already in use"],
						});
						return;
					}
					conn.nick = nick;
					this.maybeRegister(conn);
					return;
				}
				const old = conn.prefix;
				for (const peer of this.peers(conn, true)) {
					peer.send({ tags: {}, prefix: old, command: "NICK", params: [nick] });
				}
				for (const ch of this.channels.values()) {
					const p = ch.members.get(cm(conn.nick));
					if (p !== undefined) {
						ch.members.delete(cm(conn.nick));
						ch.members.set(cm(nick), p);
					}
				}
				conn.nick = nick;
				return;
			}
			case "USER":
				conn.user = msg.params[0];
				conn.realname = msg.params[3];
				this.maybeRegister(conn);
				return;
			case "PING":
				reply({ command: "PONG", params: [SERVER_NAME, msg.params[0]] });
				return;
			case "BOUNCER":
				return this.handleBouncer(conn, msg, reply);
		}

		if (!conn.registered) {
			return;
		}

		switch (msg.command) {
			case "JOIN":
				for (const name of msg.params[0].split(",")) {
					this.join(conn, name, label);
				}
				break;
			case "PART":
				this.part(conn, msg.params[0], msg.params[1]);
				break;
			case "NAMES": {
				const ch = this.channels.get(cm(msg.params[0]));
				if (ch) {
					this.names(conn, ch, label);
				} else {
					reply({ command: "366", params: [conn.nick, msg.params[0], "End of /NAMES list"] });
				}
				break;
			}
			case "SEARCH":
				this.search(conn, msg, label);
				break;
			case "WEBPUSH":
				this.webpush.set(msg.params[1], msg.params[0].toUpperCase() === "REGISTER");
				reply({ command: "WEBPUSH", params: [msg.params[0].toUpperCase(), msg.params[1]] });
				break;
			case "PRIVMSG":
			case "NOTICE":
			case "TAGMSG":
				this.message(conn, msg);
				break;
			case "TOPIC": {
				const ch = this.channels.get(cm(msg.params[0]));
				if (!ch) {
					reply({ command: "403", params: [conn.nick, msg.params[0], "No such channel"] });
					return;
				}
				if (msg.params.length < 2) {
					reply({
						command: ch.topic ? "332" : "331",
						params: [conn.nick, ch.name, ch.topic || "No topic is set"],
					});
					return;
				}
				ch.topic = msg.params[1];
				this.broadcastChannel(ch, {
					tags: {},
					prefix: conn.prefix,
					command: "TOPIC",
					params: [ch.name, ch.topic],
				});
				break;
			}
			case "WHO":
				this.who(conn, msg, reply);
				break;
			case "WHOIS": {
				const target = this.findConn(msg.params[0]);
				if (!target) {
					reply({ command: "401", params: [conn.nick, msg.params[0], "No such nick/channel"] });
					return;
				}
				reply({
					command: "311",
					params: [conn.nick, target.nick, target.user, "fake.host", "*", target.realname],
				});
				reply({ command: "318", params: [conn.nick, target.nick, "End of /WHOIS list"] });
				break;
			}
			case "CHATHISTORY":
				this.chathistory(conn, msg, label);
				break;
			case "MARKREAD":
				this.markread(conn, msg);
				break;
			case "REDACT": {
				const [target, msgid] = msg.params;
				const out: Msg = { tags: {}, prefix: conn.prefix, command: "REDACT", params: msg.params };
				const ch = this.channels.get(cm(target));
				if (ch) {
					this.broadcastChannel(ch, out);
				} else {
					for (const c of [...this.connsFor(target), ...this.connsFor(conn.nick)]) {
						c.send(out);
					}
				}
				const hist = this.history.get(cm(ch ? target : this.dmKey(conn.nick, target)));
				const i = hist?.findIndex((e) => e.msgid === msgid) ?? -1;
				if (hist && i >= 0) {
					hist.splice(i, 1);
				}
				break;
			}
			case "MONITOR":
				if (msg.params[0] === "+") {
					const online: string[] = [];
					const offline: string[] = [];
					for (const t of msg.params[1].split(",")) {
						conn.monitored.add(cm(t));
						(this.findConn(t) ? online : offline).push(t);
					}
					if (online.length) {
						conn.numeric("730", online.join(","));
					}
					if (offline.length) {
						conn.numeric("731", offline.join(","));
					}
				} else if (msg.params[0] === "-") {
					for (const t of msg.params[1].split(",")) {
						conn.monitored.delete(cm(t));
					}
				}
				break;
			case "AWAY":
				conn.away = msg.params[0] || null;
				conn.numeric(
					conn.away ? "306" : "305",
					conn.away
						? "You have been marked as being away"
						: "You are no longer marked as being away",
				);
				for (const peer of this.peers(conn, false)) {
					if (peer.caps.has("away-notify")) {
						peer.send({
							tags: {},
							prefix: conn.prefix,
							command: "AWAY",
							params: conn.away ? [conn.away] : [],
						});
					}
				}
				break;
			case "SETNAME":
				conn.realname = msg.params[0];
				for (const peer of this.peers(conn, true)) {
					if (peer.caps.has("setname")) {
						peer.send({
							tags: {},
							prefix: conn.prefix,
							command: "SETNAME",
							params: [conn.realname],
						});
					}
				}
				break;
			case "MODE":
				if (msg.params.length === 1) {
					const ch = this.channels.get(cm(msg.params[0]));
					if (ch) {
						reply({ command: "324", params: [conn.nick, ch.name, "+nt"] });
					} else {
						reply({ command: "221", params: [conn.nick, "+i"] });
					}
					break;
				}
				{
					const ch = this.channels.get(cm(msg.params[0]));
					if (!ch) {
						break;
					}
					const [mode, arg] = [msg.params[1], msg.params[2]];
					if ((mode === "+o" || mode === "-o" || mode === "+v" || mode === "-v") && arg) {
						const p = mode[1] === "o" ? "@" : "+";
						const cur = ch.members.get(cm(arg)) ?? "";
						ch.members.set(
							cm(arg),
							mode[0] === "+" ? (cur.includes(p) ? cur : p + cur) : cur.replace(p, ""),
						);
					}
					this.broadcastChannel(ch, {
						tags: {},
						prefix: conn.prefix,
						command: "MODE",
						params: msg.params,
					});
				}
				break;
			case "QUIT":
				conn.ws.close();
				break;
			default:
				reply({ command: "421", params: [conn.nick, msg.command, "Unknown command"] });
		}
	}

	handleCap(conn: Conn, msg: Msg): void {
		const sub = msg.params[0]?.toUpperCase();
		switch (sub) {
			case "LS":
				conn.capNegotiating = true;
				conn.send({ tags: {}, command: "CAP", params: [conn.nick, "LS", this.caps().join(" ")] });
				break;
			case "REQ": {
				const req = msg.params[1].split(" ").filter(Boolean);
				const known = new Set(this.caps().map((c) => c.split("=")[0]));
				const ok = req.every((c) => known.has(c.replace(/^-/, "")));
				if (ok) {
					for (const c of req) {
						if (c.startsWith("-")) {
							conn.caps.delete(c.slice(1));
						} else {
							conn.caps.add(c);
						}
					}
				}
				conn.send({
					tags: {},
					command: "CAP",
					params: [conn.nick, ok ? "ACK" : "NAK", msg.params[1]],
				});
				break;
			}
			case "END":
				conn.capNegotiating = false;
				this.maybeRegister(conn);
				break;
		}
	}

	handleAuthenticate(conn: Conn, msg: Msg): void {
		const arg = msg.params[0];
		if (!conn.saslMechanism) {
			if (arg !== "PLAIN") {
				conn.numeric("908", "PLAIN", "are available SASL mechanisms");
				conn.numeric("904", "SASL authentication failed");
				return;
			}
			conn.saslMechanism = arg;
			conn.saslPayload = "";
			conn.send({ tags: {}, command: "AUTHENTICATE", params: ["+"] });
			return;
		}
		if (arg === "*") {
			conn.saslMechanism = null;
			conn.numeric("906", "SASL authentication aborted");
			return;
		}
		if (arg !== "+") {
			conn.saslPayload += arg;
		}
		if (arg.length === 400) {
			return;
		}
		const [, user, pass] = Buffer.from(conn.saslPayload || "", "base64")
			.toString("utf8")
			.split("\0");
		conn.saslMechanism = null;
		const accounts = this.opts.accounts ?? {};
		if (accounts[user] !== undefined && accounts[user] === pass) {
			conn.account = user;
			conn.numeric("900", conn.prefix, user, `You are now logged in as ${user}`);
			conn.numeric("903", "SASL authentication successful");
		} else {
			conn.numeric("904", "SASL authentication failed");
		}
	}

	handleBouncer(
		conn: Conn,
		msg: Msg,
		reply: (m: Omit<Msg, "tags"> & { tags?: Record<string, string> }) => void,
	): void {
		if (!this.opts.bouncer) {
			reply({ command: "421", params: [conn.nick, "BOUNCER", "Unknown command"] });
			return;
		}
		switch (msg.params[0]?.toUpperCase()) {
			case "BIND":
				conn.bouncerNetwork = msg.params[1];
				break;
			case "LISTNETWORKS": {
				const ref = "nets" + ++msgidCounter;
				reply({ command: "BATCH", params: ["+" + ref, "soju.im/bouncer-networks"] });
				for (const [id, attrs] of this.networks) {
					conn.send({
						tags: { batch: ref },
						command: "BOUNCER",
						params: ["NETWORK", id, this.formatAttrs(attrs)],
					});
				}
				conn.send({ tags: {}, command: "BATCH", params: ["-" + ref] });
				break;
			}
			case "ADDNETWORK": {
				const id = String(this.networks.size + 1);
				const attrs = Object.fromEntries(
					msg.params[1].split(";").map((kv) => {
						const [k, v] = kv.split("=");
						return [k, unescapeTag(v ?? "")];
					}),
				);
				attrs.state = "connected";
				attrs.name ||= attrs.host;
				this.networks.set(id, attrs);
				for (const c of this.conns) {
					if (c.caps.has("soju.im/bouncer-networks-notify")) {
						c.send({
							tags: {},
							command: "BOUNCER",
							params: ["NETWORK", id, this.formatAttrs(attrs)],
						});
					}
				}
				reply({ command: "BOUNCER", params: ["ADDNETWORK", id] });
				break;
			}
			case "CHANGENETWORK": {
				const id = msg.params[1];
				const attrs = this.networks.get(id);
				if (!attrs) {
					reply({
						command: "FAIL",
						params: ["BOUNCER", "INVALID_NETID", "CHANGENETWORK", id, "Unknown network"],
					});
					break;
				}
				const changes = Object.fromEntries(
					msg.params[2].split(";").map((kv) => {
						const [k, v] = kv.split("=");
						return [k, unescapeTag(v ?? "")];
					}),
				);
				Object.assign(attrs, changes);
				for (const c of this.conns) {
					if (c.caps.has("soju.im/bouncer-networks-notify")) {
						c.send({
							tags: {},
							command: "BOUNCER",
							params: ["NETWORK", id, this.formatAttrs(changes)],
						});
					}
				}
				reply({ command: "BOUNCER", params: ["CHANGENETWORK", id] });
				break;
			}
			case "DELNETWORK":
				this.networks.delete(msg.params[1]);
				for (const c of this.conns) {
					if (c.caps.has("soju.im/bouncer-networks-notify")) {
						c.send({ tags: {}, command: "BOUNCER", params: ["NETWORK", msg.params[1], "*"] });
					}
				}
				reply({ command: "BOUNCER", params: ["DELNETWORK", msg.params[1]] });
				break;
		}
	}

	formatAttrs(attrs: Record<string, string>): string {
		return Object.entries(attrs)
			.map(([k, v]) => `${k}=${escapeTag(v)}`)
			.join(";");
	}

	maybeRegister(conn: Conn): void {
		if (conn.registered || conn.capNegotiating || conn.nick === "*" || !conn.user) {
			return;
		}
		conn.registered = true;
		const isupport = [
			"CASEMAPPING=rfc1459",
			"CHANTYPES=#",
			"PREFIX=(ov)@+",
			"CHANMODES=b,k,l,imnst",
			"CHATHISTORY=100",
			"MONITOR=100",
			"WHOX",
			"BOT=B",
			...(this.isRoot(conn)
				? []
				: [
						`NETWORK=${(conn.bouncerNetwork && this.networks.get(conn.bouncerNetwork)?.name) || NETWORK}`,
					]),
			"LINELEN=512",
			"STATUSMSG=@+",
			// A valid P-256 public key, push messages are never actually sent
			"VAPID=BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs",
		];
		if (conn.bouncerNetwork) {
			isupport.push(`BOUNCER_NETID=${conn.bouncerNetwork}`);
		}
		if (this.opts.filehost) {
			isupport.push(`SOJU.IM/FILEHOST=${this.opts.filehost}`);
		}
		conn.numeric("001", `Welcome to ${NETWORK}, ${conn.nick}`);
		conn.numeric("002", `Your host is ${SERVER_NAME}`);
		conn.numeric("003", "This server was created today");
		conn.numeric("004", SERVER_NAME, "fake-ircd-1.0", "i", "bklmnopstv");
		conn.numeric("005", ...isupport, "are supported by this server");
		conn.numeric("375", `- ${SERVER_NAME} Message of the day -`);
		conn.numeric("372", "- Welcome to the fake IRC server");
		conn.numeric("376", "End of /MOTD command");

		if (this.isRoot(conn) && conn.caps.has("soju.im/bouncer-networks-notify")) {
			const ref = "nets" + ++msgidCounter;
			conn.send({ tags: {}, command: "BATCH", params: ["+" + ref, "soju.im/bouncer-networks"] });
			for (const [id, attrs] of this.networks) {
				conn.send({
					tags: { batch: ref },
					command: "BOUNCER",
					params: ["NETWORK", id, this.formatAttrs(attrs)],
				});
			}
			conn.send({ tags: {}, command: "BATCH", params: ["-" + ref] });
		}

		// Notify monitors
		for (const c of this.conns) {
			if (c !== conn && c.monitored.has(cm(conn.nick))) {
				c.numeric("730", conn.prefix);
			}
		}
	}

	/** Connections sharing a channel with conn, optionally including conn itself. */
	peers(conn: Conn, includeSelf: boolean): Set<Conn> {
		const set = new Set<Conn>();
		for (const ch of this.channels.values()) {
			if (!ch.members.has(cm(conn.nick))) {
				continue;
			}
			for (const nick of ch.members.keys()) {
				for (const c of this.connsFor(nick)) {
					set.add(c);
				}
			}
		}
		if (includeSelf) {
			for (const c of this.connsFor(conn.nick)) {
				set.add(c);
			}
		} else {
			for (const c of this.connsFor(conn.nick)) {
				set.delete(c);
			}
		}
		return set;
	}

	broadcastChannel(ch: Channel, msg: Msg, except?: Conn): void {
		const time = msg.tags.time || now();
		for (const nick of ch.members.keys()) {
			for (const c of this.connsFor(nick)) {
				if (c !== except) {
					c.send(msg, { time });
				}
			}
		}
	}

	join(conn: Conn, name: string, label?: string): void {
		if (!name.startsWith("#")) {
			conn.numeric("403", name, "No such channel");
			return;
		}
		let ch = this.channels.get(cm(name));
		if (!ch) {
			ch = { name, topic: "", members: new Map() };
			this.channels.set(cm(name), ch);
		}
		if (ch.members.has(cm(conn.nick))) {
			return;
		}
		ch.members.set(cm(conn.nick), ch.members.size === 0 ? "@" : "");
		const time = now();
		for (const nick of ch.members.keys()) {
			for (const c of this.connsFor(nick)) {
				const params = c.caps.has("extended-join")
					? [ch.name, conn.account || "*", conn.realname]
					: [ch.name];
				const tags: Record<string, string> = {};
				if (c === conn && label && c.caps.has("labeled-response")) {
					tags.label = label;
				}
				c.send({ tags, prefix: conn.prefix, command: "JOIN", params }, { time });
			}
		}
		this.record(ch.name, {
			time,
			msgid: this.nextMsgid(),
			prefix: conn.prefix,
			command: "JOIN",
			params: [ch.name],
			tags: {},
		});

		if (ch.topic) {
			conn.numeric("332", ch.name, ch.topic);
		} else {
			conn.numeric("331", ch.name, "No topic is set");
		}
		if (!conn.caps.has("soju.im/no-implicit-names")) {
			this.names(conn, ch);
		}
		if (conn.caps.has("draft/read-marker")) {
			const ts = this.readMarkers.get(this.markerKey(conn, ch.name));
			conn.send({ tags: {}, command: "MARKREAD", params: [ch.name, ts ? "timestamp=" + ts : "*"] });
		}
	}

	names(conn: Conn, ch: Channel, label?: string): void {
		const names = [...ch.members.entries()].map(([k, p]) => {
			const c = this.connsFor(k)[0];
			let display = c ? c.nick : k;
			if (c && conn.caps.has("userhost-in-names")) {
				display = c.prefix;
			}
			return (conn.caps.has("multi-prefix") ? p : p.slice(0, 1)) + display;
		});
		const tags: Record<string, string> = label && conn.caps.has("labeled-response") ? { label } : {};
		conn.send({ tags, command: "353", params: [conn.nick, "=", ch.name, names.join(" ")] });
		conn.send({ tags, command: "366", params: [conn.nick, ch.name, "End of /NAMES list"] });
	}

	part(conn: Conn, name: string, reason?: string): void {
		const ch = this.channels.get(cm(name));
		if (!ch || !ch.members.has(cm(conn.nick))) {
			conn.numeric("442", name, "You're not on that channel");
			return;
		}
		const params = reason ? [ch.name, reason] : [ch.name];
		this.broadcastChannel(ch, { tags: {}, prefix: conn.prefix, command: "PART", params });
		this.record(ch.name, {
			time: now(),
			msgid: this.nextMsgid(),
			prefix: conn.prefix,
			command: "PART",
			params,
			tags: {},
		});
		ch.members.delete(cm(conn.nick));
	}

	quit(conn: Conn, reason: string): void {
		if (this.connsFor(conn.nick).length > 0) {
			return; // Another connection still uses this nick
		}
		const msg: Msg = { tags: {}, prefix: conn.prefix, command: "QUIT", params: [reason] };
		for (const peer of this.peers(conn, false)) {
			peer.send(msg);
		}
		for (const ch of this.channels.values()) {
			ch.members.delete(cm(conn.nick));
		}
		for (const c of this.conns) {
			if (c.monitored.has(cm(conn.nick))) {
				c.numeric("731", conn.nick);
			}
		}
	}

	nextMsgid(): string {
		return "msg" + ++msgidCounter;
	}

	dmKey(a: string, b: string): string {
		return [cm(a), cm(b)].sort().join("\0");
	}

	markerKey(conn: Conn, target: string): string {
		return (conn.account || cm(conn.nick)) + "\0" + cm(target);
	}

	record(target: string, entry: HistoryEntry): void {
		const key = cm(target);
		const l = this.history.get(key) ?? [];
		l.push(entry);
		this.history.set(key, l);
	}

	message(conn: Conn, msg: Msg): void {
		const target = msg.params[0];
		const clientTags = Object.fromEntries(Object.entries(msg.tags).filter(([k]) => k.startsWith("+")));
		const time = now();
		const msgid = this.nextMsgid();
		const out: Msg = {
			tags: { ...clientTags, msgid, time },
			prefix: conn.prefix,
			command: msg.command,
			params: msg.params,
		};

		const ch = this.channels.get(cm(target.replace(/^[@+]+/, "")));
		if (target.startsWith("#") || /^[@+]#/.test(target)) {
			if (!ch) {
				conn.numeric("403", target, "No such channel");
				return;
			}
			for (const nick of ch.members.keys()) {
				for (const c of this.connsFor(nick)) {
					if (c === conn && !c.caps.has("echo-message")) {
						continue;
					}
					if (msg.command === "TAGMSG" && !c.caps.has("message-tags")) {
						continue;
					}
					const tags = { ...out.tags };
					if (c === conn && msg.tags.label && c.caps.has("labeled-response")) {
						tags.label = msg.tags.label;
					}
					c.send({ ...out, tags });
				}
			}
			if (msg.command !== "TAGMSG") {
				this.record(ch.name, {
					time,
					msgid,
					prefix: conn.prefix,
					command: msg.command,
					params: msg.params,
					tags: clientTags,
				});
			}
			return;
		}

		const recipients = this.connsFor(target);
		if (recipients.length === 0) {
			conn.numeric("401", target, "No such nick/channel");
			return;
		}
		for (const c of new Set([...recipients, ...this.connsFor(conn.nick)])) {
			if (c === conn && !c.caps.has("echo-message")) {
				continue;
			}
			c.send(out);
		}
		if (msg.command !== "TAGMSG") {
			this.record(this.dmKey(conn.nick, target), {
				time,
				msgid,
				prefix: conn.prefix,
				command: msg.command,
				params: msg.params,
				tags: clientTags,
			});
		}
	}

	historyFor(conn: Conn, target: string): HistoryEntry[] {
		if (target.startsWith("#")) {
			return this.history.get(cm(target)) ?? [];
		}
		return this.history.get(this.dmKey(conn.nick, target)) ?? [];
	}

	chathistory(conn: Conn, msg: Msg, label?: string): void {
		const sub = msg.params[0].toUpperCase();
		const ref = "hist" + ++msgidCounter;
		const batchTags: Record<string, string> = {};
		if (label && conn.caps.has("labeled-response")) {
			batchTags.label = label;
		}
		const parseBound = (s: string) => (s === "*" ? null : s.replace(/^(timestamp|msgid)=/, ""));

		if (sub === "TARGETS") {
			conn.send({
				tags: batchTags,
				command: "BATCH",
				params: ["+" + ref, "draft/chathistory-targets"],
			});
			const [a, b] = [parseBound(msg.params[1])!, parseBound(msg.params[2])!].sort();
			const seen = new Map<string, string>();
			for (const [key, entries] of this.history) {
				let name: string | null = null;
				if (key.startsWith("#")) {
					const ch = this.channels.get(key);
					if (!ch?.members.has(cm(conn.nick))) {
						continue;
					}
					name = ch.name;
				} else if (key.split("\0").includes(cm(conn.nick))) {
					const other = entries[0].prefix.split("!")[0];
					name = cm(other) === cm(conn.nick) ? entries[0].params[0] : other;
				}
				if (!name) {
					continue;
				}
				const inRange = entries.filter((e) => e.time >= a && e.time <= b);
				if (inRange.length > 0) {
					seen.set(name, inRange[inRange.length - 1].time);
				}
			}
			for (const [name, time] of seen) {
				conn.send({ tags: { batch: ref }, command: "CHATHISTORY", params: ["TARGETS", name, time] });
			}
			conn.send({ tags: {}, command: "BATCH", params: ["-" + ref] });
			return;
		}

		const target = msg.params[1];
		let entries = this.historyFor(conn, target);
		const limit = parseInt(msg.params[msg.params.length - 1], 10) || 50;
		const bound = parseBound(msg.params[2]);
		const resolve = (b: string) => {
			const byId = entries.find((e) => e.msgid === b);
			return byId ? byId.time : b;
		};
		switch (sub) {
			case "BEFORE":
				entries = entries.filter((e) => e.time < resolve(bound!)).slice(-limit);
				break;
			case "AFTER":
				entries = entries.filter((e) => e.time > resolve(bound!)).slice(0, limit);
				break;
			case "LATEST":
				entries = (bound ? entries.filter((e) => e.time > resolve(bound)) : entries).slice(-limit);
				break;
			case "AROUND": {
				const t = resolve(bound!);
				const i = entries.findIndex((e) => e.time >= t);
				entries = entries.slice(Math.max(0, i - Math.floor(limit / 2)), i + Math.ceil(limit / 2));
				break;
			}
			default:
				conn.send({
					tags: batchTags,
					command: "FAIL",
					params: ["CHATHISTORY", "INVALID_PARAMS", sub, "Unknown subcommand"],
				});
				return;
		}
		if (!conn.caps.has("draft/event-playback")) {
			entries = entries.filter((e) => e.command === "PRIVMSG" || e.command === "NOTICE");
		}

		conn.send({ tags: batchTags, command: "BATCH", params: ["+" + ref, "chathistory", target] });
		for (const e of entries) {
			conn.send({
				tags: { ...e.tags, batch: ref, msgid: e.msgid, time: e.time },
				prefix: e.prefix,
				command: e.command,
				params: e.params,
			});
		}
		conn.send({ tags: {}, command: "BATCH", params: ["-" + ref] });
	}

	search(conn: Conn, msg: Msg, label?: string): void {
		const attrs = Object.fromEntries(
			msg.params[0].split(";").map((kv) => {
				const i = kv.indexOf("=");
				return i < 0 ? [kv, ""] : [kv.slice(0, i), unescapeTag(kv.slice(i + 1))];
			}),
		);
		const tags: Record<string, string> = label && conn.caps.has("labeled-response") ? { label } : {};
		const ref = "search" + ++msgidCounter;
		const results: { target: string; e: HistoryEntry }[] = [];
		for (const [key, entries] of this.history) {
			const isChannel = key.startsWith("#");
			if (
				isChannel
					? !this.channels.get(key)?.members.has(cm(conn.nick))
					: !key.split("\0").includes(cm(conn.nick))
			) {
				continue;
			}
			for (const e of entries) {
				if (e.command !== "PRIVMSG" && e.command !== "NOTICE") {
					continue;
				}
				if (
					attrs.in &&
					cm(e.params[0]) !== cm(attrs.in) &&
					!(cm(e.prefix.split("!")[0]) === cm(attrs.in))
				) {
					continue;
				}
				if (attrs.from && cm(e.prefix.split("!")[0]) !== cm(attrs.from)) {
					continue;
				}
				if (attrs.text && !e.params[1].toLowerCase().includes(attrs.text.toLowerCase())) {
					continue;
				}
				results.push({ target: e.params[0], e });
			}
		}
		results.sort((a, b) => (a.e.time < b.e.time ? -1 : 1));
		const limit = parseInt(attrs.limit || "100", 10);
		conn.send({ tags, command: "BATCH", params: ["+" + ref, "soju.im/search"] });
		for (const { e } of results.slice(-limit)) {
			conn.send({
				tags: { batch: ref, msgid: e.msgid, time: e.time },
				prefix: e.prefix,
				command: e.command,
				params: e.params,
			});
		}
		conn.send({ tags: {}, command: "BATCH", params: ["-" + ref] });
	}

	markread(conn: Conn, msg: Msg): void {
		const target = msg.params[0];
		const key = this.markerKey(conn, target);
		if (msg.params[1]) {
			const ts = msg.params[1].replace(/^timestamp=/, "");
			const cur = this.readMarkers.get(key);
			if (!cur || cur < ts) {
				this.readMarkers.set(key, ts);
			}
			const out: Msg = {
				tags: {},
				command: "MARKREAD",
				params: [target, "timestamp=" + this.readMarkers.get(key)],
			};
			for (const c of this.connsFor(conn.nick)) {
				if (c.caps.has("draft/read-marker")) {
					c.send(out);
				}
			}
		} else {
			const ts = this.readMarkers.get(key);
			conn.send({ tags: {}, command: "MARKREAD", params: [target, ts ? "timestamp=" + ts : "*"] });
		}
	}

	who(conn: Conn, msg: Msg, reply: (m: Omit<Msg, "tags">) => void): void {
		const mask = msg.params[0];
		const whox = msg.params[1]?.startsWith("%") ? msg.params[1].slice(1) : null;
		let fields = "";
		let token = "";
		if (whox) {
			[fields, token] = whox.split(",");
		}
		let targets: Conn[] = [];
		const ch = this.channels.get(cm(mask));
		if (ch) {
			targets = [...ch.members.keys()].flatMap((n) => this.connsFor(n).slice(0, 1));
		} else {
			const c = this.findConn(mask);
			if (c) {
				targets = [c];
			}
		}
		for (const t of targets) {
			const flags = (t.away ? "G" : "H") + (ch ? (ch.members.get(cm(t.nick)) ?? "") : "");
			if (whox) {
				const values: Record<string, string> = {
					t: token,
					c: ch ? ch.name : "*",
					u: t.user,
					h: "fake.host",
					s: SERVER_NAME,
					n: t.nick,
					f: flags,
					a: t.account || "0",
					r: t.realname,
				};
				const out = [...fields].filter((f) => "tcuhsnfar".includes(f));
				out.sort((a, b) => "tcuhsnfar".indexOf(a) - "tcuhsnfar".indexOf(b));
				reply({ command: "354", params: [conn.nick, ...out.map((f) => values[f])] });
			} else {
				reply({
					command: "352",
					params: [
						conn.nick,
						ch ? ch.name : "*",
						t.user,
						"fake.host",
						SERVER_NAME,
						t.nick,
						flags,
						"0 " + t.realname,
					],
				});
			}
		}
		reply({ command: "315", params: [conn.nick, mask, "End of WHO list"] });
	}
}

export function startServer(opts: ServerOptions): FakeServer {
	return new FakeServer(opts);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const port = parseInt(process.argv[2] || "8081", 10);
	const server = startServer({
		port,
		accounts: { alice: "secret" },
		bouncer: process.env.FAKE_BOUNCER === "1",
	});
	server.wss.on("listening", () => console.log(`fake-ircd listening on ws://localhost:${server.port}`));
}
