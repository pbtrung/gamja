import * as irc from "./irc";
import type { Message, OutgoingMessage, Prefix, Batch } from "./irc";

// Static list of capabilities that are always requested when supported by the
// server
const permanentCaps = [
	"account-notify",
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
	"sasl",
	"server-time",
	"setname",

	"draft/account-registration",
	"draft/chathistory",
	"draft/extended-monitor",
	"draft/message-redaction",
	"draft/read-marker",

	"soju.im/bouncer-networks",
];

const RECONNECT_MIN_DELAY_MSEC = 10 * 1000; // 10s
const RECONNECT_MAX_DELAY_MSEC = 10 * 60 * 1000; // 10min

// WebSocket status codes
// https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1
const WEBSOCKET_CLOSE_CODES = {
	NORMAL_CLOSURE: 1000,
	GOING_AWAY: 1001,
	PROTOCOL_ERROR: 1002,
	UNSUPPORTED_DATA: 1003,
	NO_STATUS_CODE: 1005,
	ABNORMAL_CLOSURE: 1006,
	INVALID_FRAME_PAYLOAD_DATA: 1007,
	POLICY_VIOLATION: 1008,
	MESSAGE_TOO_BIG: 1009,
	MISSING_MANDATORY_EXT: 1010,
	INTERNAL_SERVER_ERROR: 1011,
	TLS_HANDSHAKE_FAILED: 1015,
};
const WEBSOCKET_CLOSE_CODE_NAMES: Record<number, string> = {
	[WEBSOCKET_CLOSE_CODES.GOING_AWAY]: "going away",
	[WEBSOCKET_CLOSE_CODES.PROTOCOL_ERROR]: "protocol error",
	[WEBSOCKET_CLOSE_CODES.UNSUPPORTED_DATA]: "unsupported data",
	[WEBSOCKET_CLOSE_CODES.NO_STATUS_CODE]: "no status code received",
	[WEBSOCKET_CLOSE_CODES.ABNORMAL_CLOSURE]: "abnormal closure",
	[WEBSOCKET_CLOSE_CODES.INVALID_FRAME_PAYLOAD_DATA]: "invalid frame payload data",
	[WEBSOCKET_CLOSE_CODES.POLICY_VIOLATION]: "policy violation",
	[WEBSOCKET_CLOSE_CODES.MESSAGE_TOO_BIG]: "message too big",
	[WEBSOCKET_CLOSE_CODES.MISSING_MANDATORY_EXT]: "missing mandatory extension",
	[WEBSOCKET_CLOSE_CODES.INTERNAL_SERVER_ERROR]: "internal server error",
	[WEBSOCKET_CLOSE_CODES.TLS_HANDSHAKE_FAILED]: "TLS handshake failed",
};

// See https://github.com/quakenet/snircd/blob/master/doc/readme.who
// Sorted by order of appearance in RPL_WHOSPCRPL
const WHOX_FIELDS = {
	channel: "c",
	username: "u",
	hostname: "h",
	server: "s",
	nick: "n",
	flags: "f",
	account: "a",
	realname: "r",
} as const;

export type WhoxField = keyof typeof WHOX_FIELDS;

export interface WhoReply {
	channel?: string;
	username?: string;
	hostname?: string;
	server?: string;
	nick: string;
	flags?: string;
	account?: string | null;
	realname?: string;
}

const FALLBACK_SERVER_PREFIX: Prefix = { name: "*" };

let lastPing = 0;
let lastLabel = 0;
let lastWhoxToken = 0;

export class IRCError extends Error {
	msg: Message;

	constructor(msg: Message) {
		let text;
		if (msg.params.length > 0) {
			// IRC errors have a human-readable message as last param
			text = msg.params[msg.params.length - 1];
		} else {
			text = `unknown error (${msg.command})`;
		}
		super(text);

		this.msg = msg;
	}
}

class WebSocketError extends Error {
	constructor(code: number) {
		let text = "Connection error";
		const name = WEBSOCKET_CLOSE_CODE_NAMES[code];
		if (name) {
			text += " (" + name + ")";
		}

		super(text);
	}
}

/**
 * Implements a simple exponential backoff.
 */
export class Backoff {
	n = 0;
	base: number;
	max: number;

	constructor(base: number, max: number) {
		this.base = base;
		this.max = max;
	}

	reset(): void {
		this.n = 0;
	}

	next(): number {
		if (this.n === 0) {
			this.n = 1;
			return 0;
		}

		let dur = this.n * this.base;
		if (dur > this.max) {
			dur = this.max;
		} else {
			this.n *= 2;
		}

		return dur;
	}
}

export const ClientStatus = {
	DISCONNECTED: "disconnected",
	CONNECTING: "connecting",
	REGISTERING: "registering",
	REGISTERED: "registered",
} as const;

export type ClientStatus = (typeof ClientStatus)[keyof typeof ClientStatus];

export interface SASLPlain {
	username: string;
	password: string;
}

export interface SASLOAuthBearer {
	token: string;
	username?: string | null;
}

export interface ClientParams {
	url: string;
	username: string;
	realname: string;
	nick: string;
	pass?: string | null;
	saslPlain?: SASLPlain | null;
	saslExternal?: boolean;
	saslOauthBearer?: SASLOAuthBearer | null;
	bouncerNetwork?: string | null;
	ping?: number;
	eventPlayback?: boolean;
	autojoin?: string[];
}

export interface MessageEventDetail {
	message: Message;
	batch: Batch | null;
}

export interface BatchResult extends Batch {
	messages: Message[];
}

export interface ChatHistoryTarget {
	name: string;
	latestMessage: string;
}

export type BouncerNetworkAttrs = Record<string, string | null | undefined>;

export default class Client extends EventTarget {
	static Status = ClientStatus;

	status: ClientStatus = ClientStatus.DISCONNECTED;
	serverPrefix: Prefix = FALLBACK_SERVER_PREFIX;
	nick: string | null = null;
	supportsCap = false;
	caps = new irc.CapRegistry();
	isupport = new irc.Isupport();

	ws: WebSocket | null = null;
	params: ClientParams = {
		url: "",
		username: "",
		realname: "",
		nick: "",
		pass: null,
		saslPlain: null,
		saslExternal: false,
		saslOauthBearer: null,
		bouncerNetwork: null,
		ping: 0,
		eventPlayback: true,
	};
	debug = false;
	batches = new Map<string, Batch>();
	autoReconnect = true;
	reconnectTimeoutID: ReturnType<typeof setTimeout> | null = null;
	reconnectBackoff = new Backoff(RECONNECT_MIN_DELAY_MSEC, RECONNECT_MAX_DELAY_MSEC);
	lastReconnectDate = new Date(0);
	pingIntervalID: ReturnType<typeof setInterval> | null = null;
	pendingCmds: Record<string, Promise<unknown>> = {
		WHO: Promise.resolve(null),
		CHATHISTORY: Promise.resolve(null),
	};
	cm: irc.CaseMapFn = irc.CaseMapping.RFC1459;
	monitored = new irc.CaseMapMap<boolean>(null, irc.CaseMapping.RFC1459);
	pendingLists = new irc.CaseMapMap<Message[]>(null, irc.CaseMapping.RFC1459);
	whoxQueries = new Map<string, string>();

	constructor(params: Partial<ClientParams> & { url: string }) {
		super();

		this.handleOnline = this.handleOnline.bind(this);

		this.params = { ...this.params, ...params };

		this.reconnect();
	}

	reconnect(): void {
		const autoReconnect = this.autoReconnect;
		this.disconnect();
		this.autoReconnect = autoReconnect;

		console.log("Connecting to " + this.params.url);
		this.setStatus(ClientStatus.CONNECTING);
		this.lastReconnectDate = new Date();

		let ws: WebSocket;
		try {
			ws = new WebSocket(this.params.url);
		} catch (err) {
			console.error("Failed to create connection:", err);
			setTimeout(() => {
				this.dispatchError(new Error("Failed to create connection", { cause: err }));
				this.setStatus(ClientStatus.DISCONNECTED);
			}, 0);
			return;
		}
		this.ws = ws;
		ws.addEventListener("open", this.handleOpen.bind(this));

		ws.addEventListener("message", (event) => {
			try {
				this.handleMessage(event);
			} catch (err) {
				this.dispatchError(err);
				this.disconnect();
			}
		});

		ws.addEventListener("close", (event) => {
			console.log("Connection closed (code: " + event.code + ")");

			if (
				event.code !== WEBSOCKET_CLOSE_CODES.NORMAL_CLOSURE &&
				event.code !== WEBSOCKET_CLOSE_CODES.GOING_AWAY
			) {
				this.dispatchError(new WebSocketError(event.code));
			}

			this.ws = null;
			this.setStatus(ClientStatus.DISCONNECTED);
			this.nick = null;
			this.serverPrefix = FALLBACK_SERVER_PREFIX;
			this.caps = new irc.CapRegistry();
			this.batches = new Map();
			Object.keys(this.pendingCmds).forEach((k) => {
				this.pendingCmds[k] = Promise.resolve(null);
			});
			this.isupport = new irc.Isupport();
			this.monitored = new irc.CaseMapMap(null, irc.CaseMapping.RFC1459);

			if (this.autoReconnect) {
				globalThis.addEventListener?.("online", this.handleOnline);

				if (!navigator.onLine) {
					console.info("Waiting for network to go back online");
				} else {
					let delay = this.reconnectBackoff.next();
					const sinceLastReconnect = Date.now() - this.lastReconnectDate.getTime();
					if (sinceLastReconnect < RECONNECT_MIN_DELAY_MSEC) {
						delay = Math.max(delay, RECONNECT_MIN_DELAY_MSEC);
					}
					console.info("Reconnecting to server in " + delay / 1000 + " seconds");
					if (this.reconnectTimeoutID) {
						clearTimeout(this.reconnectTimeoutID);
					}
					this.reconnectTimeoutID = setTimeout(() => {
						this.reconnect();
					}, delay);
				}
			}
		});
	}

	disconnect(): void {
		this.autoReconnect = false;

		if (this.reconnectTimeoutID) {
			clearTimeout(this.reconnectTimeoutID);
		}
		this.reconnectTimeoutID = null;

		globalThis.removeEventListener?.("online", this.handleOnline);

		this.setPingInterval(0);

		if (this.ws) {
			this.ws.close(WEBSOCKET_CLOSE_CODES.NORMAL_CLOSURE);
		}
	}

	setStatus(status: ClientStatus): void {
		if (this.status === status) {
			return;
		}
		this.status = status;
		this.dispatchEvent(new CustomEvent("status"));
	}

	dispatchError(err: unknown): void {
		this.dispatchEvent(new CustomEvent("error", { detail: err }));
	}

	handleOnline(): void {
		globalThis.removeEventListener?.("online", this.handleOnline);
		if (this.autoReconnect && this.status === ClientStatus.DISCONNECTED) {
			this.reconnect();
		}
	}

	handleOpen(): void {
		console.log("Connection opened");
		this.setStatus(ClientStatus.REGISTERING);

		this.reconnectBackoff.reset();
		this.setPingInterval(this.params.ping || 0);

		this.nick = this.params.nick;

		this.send({ command: "CAP", params: ["LS", "302"] });
		if (this.params.pass) {
			this.send({ command: "PASS", params: [this.params.pass] });
		}
		this.send({ command: "NICK", params: [this.nick] });
		this.send({
			command: "USER",
			params: [this.params.username, "0", "*", this.params.realname],
		});
	}

	pushPendingList(k: string, msg: Message): void {
		let l = this.pendingLists.get(k);
		if (!l) {
			l = [];
			this.pendingLists.set(k, l);
		}
		l.push(msg);
	}

	endPendingList(k: string, msg: Message): void {
		msg.list = this.pendingLists.get(k) || [];
		this.pendingLists.delete(k);
	}

	handleMessage(event: MessageEvent): void {
		if (typeof event.data !== "string") {
			console.error("Received unsupported data type:", event.data);
			this.ws?.close(WEBSOCKET_CLOSE_CODES.UNSUPPORTED_DATA);
			return;
		}

		const raw = event.data;
		if (this.debug) {
			console.debug("Received:", raw);
		}

		const msg = irc.parseMessage(raw);

		// If the prefix is missing, assume it's coming from the server on the
		// other end of the connection
		if (!msg.prefix) {
			msg.prefix = this.serverPrefix;
		}

		let msgBatch: Batch | null = null;
		const batchTag = msg.tags["batch"];
		if (batchTag) {
			msgBatch = this.batches.get(batchTag) || null;
			if (msgBatch) {
				msg.batch = msgBatch;
			}
		}

		let deleteBatch: string | null = null;
		switch (msg.command) {
			case irc.RPL_WELCOME:
				if (this.params.saslPlain && !this.supportsCap) {
					this.dispatchError(new Error("Server doesn't support SASL PLAIN"));
					this.disconnect();
					return;
				}

				if (msg.prefix) {
					this.serverPrefix = msg.prefix;
				}
				this.nick = msg.params[0];

				console.log("Registration complete");
				this.setStatus(ClientStatus.REGISTERED);
				break;
			case irc.RPL_ISUPPORT: {
				const prevMaxMonitorTargets = this.isupport.monitor();

				const tokens = msg.params.slice(1, -1);
				this.isupport.parse(tokens);
				this.updateCaseMapping();

				const maxMonitorTargets = this.isupport.monitor();
				if (prevMaxMonitorTargets === 0 && this.monitored.size > 0 && maxMonitorTargets > 0) {
					const targets = Array.from(this.monitored.keys()).slice(0, maxMonitorTargets);
					this.send({ command: "MONITOR", params: ["+", targets.join(",")] });
				}
				break;
			}
			case irc.RPL_ENDOFMOTD:
			case irc.ERR_NOMOTD:
				// These messages are used to indicate the end of the ISUPPORT list
				if (!this.isupport.raw.has("CASEMAPPING")) {
					// Server didn't send any CASEMAPPING token, assume RFC 1459
					this.updateCaseMapping();
				}
				break;
			case "CAP":
				this.handleCap(msg);
				break;
			case "AUTHENTICATE": {
				// Both PLAIN and EXTERNAL expect an empty challenge
				const challengeStr = msg.params[0];
				if (challengeStr !== "+") {
					this.dispatchError(new Error("Expected an empty challenge, got: " + challengeStr));
					this.send({ command: "AUTHENTICATE", params: ["*"] });
				}
				break;
			}
			case irc.RPL_LOGGEDIN:
				console.log("Logged in");
				break;
			case irc.RPL_LOGGEDOUT:
				console.log("Logged out");
				break;
			case irc.RPL_NAMREPLY:
				this.pushPendingList("NAMES " + msg.params[2], msg);
				break;
			case irc.RPL_ENDOFNAMES:
				this.endPendingList("NAMES " + msg.params[1], msg);
				break;
			case irc.RPL_WHOISUSER:
			case irc.RPL_WHOISSERVER:
			case irc.RPL_WHOISOPERATOR:
			case irc.RPL_WHOISIDLE:
			case irc.RPL_WHOISCHANNELS:
			case irc.RPL_WHOISACCOUNT:
				this.pushPendingList("WHOIS " + msg.params[1], msg);
				break;
			case irc.RPL_ENDOFWHOIS:
				this.endPendingList("WHOIS " + msg.params[1], msg);
				break;
			case irc.RPL_WHOREPLY:
			case irc.RPL_WHOSPCRPL:
				this.pushPendingList("WHO", msg);
				break;
			case irc.RPL_ENDOFWHO:
				this.endPendingList("WHO", msg);
				break;
			case "PING":
				this.send({ command: "PONG", params: [msg.params[0]] });
				break;
			case "NICK": {
				const newNick = msg.params[0];
				if (this.isMyNick(msg.prefix.name)) {
					this.nick = newNick;
				}
				break;
			}
			case "BATCH": {
				const enter = msg.params[0].startsWith("+");
				const name = msg.params[0].slice(1);
				if (enter) {
					const batch: Batch = {
						name,
						type: msg.params[1],
						params: msg.params.slice(2),
						tags: msg.tags,
						parent: msgBatch,
					};
					this.batches.set(name, batch);
				} else {
					deleteBatch = name;
				}
				break;
			}
			case "ERROR":
				this.dispatchError(new IRCError(msg));
				this.disconnect();
				break;
			case irc.ERR_PASSWDMISMATCH:
			case irc.ERR_ERRONEUSNICKNAME:
			case irc.ERR_NICKNAMEINUSE:
			case irc.ERR_NICKCOLLISION:
			case irc.ERR_UNAVAILRESOURCE:
			case irc.ERR_NOPERMFORHOST:
			case irc.ERR_YOUREBANNEDCREEP:
				this.dispatchError(new IRCError(msg));
				if (this.status !== ClientStatus.REGISTERED) {
					this.disconnect();
				}
				break;
			case "FAIL":
				if (this.status === ClientStatus.REGISTERED) {
					break;
				}
				if (msg.params[0] === "BOUNCER" && msg.params[2] === "BIND") {
					this.dispatchError(
						new Error("Failed to bind to bouncer network", {
							cause: new IRCError(msg),
						}),
					);
					this.disconnect();
				}
				if (msg.params[1] === "ACCOUNT_REQUIRED") {
					this.dispatchError(new IRCError(msg));
					this.disconnect();
				}
				break;
		}

		this.dispatchEvent(
			new CustomEvent<MessageEventDetail>("message", {
				detail: { message: msg, batch: msgBatch },
			}),
		);

		// Delete after firing the message event so that handlers can access
		// the batch
		if (deleteBatch) {
			this.batches.delete(deleteBatch);
		}
	}

	async authenticate(mechanism: string, params?: SASLPlain | SASLOAuthBearer): Promise<void> {
		if (!this.supportsSASL(mechanism)) {
			throw new Error(`${mechanism} authentication not supported by the server`);
		}
		console.log(`Starting SASL ${mechanism} authentication`);

		// Send the first SASL response immediately to avoid a roundtrip
		let initialResp;
		switch (mechanism) {
			case "PLAIN": {
				const p = params as SASLPlain;
				initialResp = "\0" + p.username + "\0" + p.password;
				break;
			}
			case "EXTERNAL":
				initialResp = "";
				break;
			case "OAUTHBEARER": {
				const p = params as SASLOAuthBearer;
				initialResp = "n,,\x01auth=Bearer " + p.token + "\x01\x01";
				break;
			}
			default:
				throw new Error(`Unknown authentication mechanism '${mechanism}'`);
		}

		const startMsg = { command: "AUTHENTICATE", params: [mechanism] };
		const promise = this.roundtrip(startMsg, (msg) => {
			switch (msg.command) {
				case irc.RPL_SASLSUCCESS:
					return true;
				case irc.ERR_NICKLOCKED:
				case irc.ERR_SASLFAIL:
				case irc.ERR_SASLTOOLONG:
				case irc.ERR_SASLABORTED:
				case irc.ERR_SASLALREADY:
					throw new IRCError(msg);
			}
		});
		for (const msg of irc.generateAuthenticateMessages(initialResp)) {
			this.send(msg);
		}
		await promise;
	}

	who(mask: string, options?: { fields?: WhoxField[] }): Promise<WhoReply[]> {
		const params = [mask];

		let fields = "",
			token = "";
		if (options && this.isupport.whox()) {
			const match = ""; // Matches exact channel or nick

			fields = "t"; // Always include token in reply
			if (options.fields) {
				for (const k of options.fields) {
					if (!WHOX_FIELDS[k]) {
						throw new Error(`Unknown WHOX field ${k}`);
					}
					fields += WHOX_FIELDS[k];
				}
			}

			token = String(lastWhoxToken % 1000);
			lastWhoxToken++;

			params.push(`${match}%${fields},${token}`);
			this.whoxQueries.set(token, fields);
		}

		const msg = { command: "WHO", params };
		const l: WhoReply[] = [];
		const promise = this.pendingCmds.WHO.then(() => {
			return this.roundtrip(msg, (msg) => {
				switch (msg.command) {
					case irc.RPL_WHOREPLY:
						msg.internal = true;
						l.push(this.parseWhoReply(msg));
						break;
					case irc.RPL_WHOSPCRPL:
						if (msg.params.length !== fields.length + 1 || msg.params[1] !== token) {
							break;
						}
						msg.internal = true;
						l.push(this.parseWhoReply(msg));
						break;
					case irc.RPL_ENDOFWHO:
						if (msg.params[1] === mask) {
							msg.internal = true;
							return l;
						}
						break;
				}
			}).finally(() => {
				this.whoxQueries.delete(token);
			});
		});
		this.pendingCmds.WHO = promise.catch(() => {});
		return promise;
	}

	parseWhoReply(msg: Message): WhoReply {
		switch (msg.command) {
			case irc.RPL_WHOREPLY: {
				const last = msg.params[msg.params.length - 1];
				return {
					username: msg.params[2],
					hostname: msg.params[3],
					server: msg.params[4],
					nick: msg.params[5],
					flags: msg.params[6],
					realname: last.slice(last.indexOf(" ") + 1),
				};
			}
			case irc.RPL_WHOSPCRPL: {
				const token = msg.params[1];
				const fields = this.whoxQueries.get(token);
				if (!fields) {
					throw new Error("Unknown WHOX token: " + token);
				}
				const who: Record<string, string | null> = {};
				let i = 0;
				for (const [k, v] of Object.entries(WHOX_FIELDS)) {
					if (fields.indexOf(v) < 0) {
						continue;
					}

					who[k] = msg.params[2 + i];
					i++;
				}
				if (who.account === "0") {
					// WHOX uses "0" to mean "no account"
					who.account = null;
				}
				return who as unknown as WhoReply;
			}
			default:
				throw new Error("Not a WHO reply: " + msg.command);
		}
	}

	async whois(target: string): Promise<Record<string, Message>> {
		const targetCM = this.cm(target);
		const msg = { command: "WHOIS", params: [target] };
		const endOfWhois = await this.roundtrip(msg, (msg) => {
			let nick;
			switch (msg.command) {
				case irc.RPL_ENDOFWHOIS:
					nick = msg.params[1];
					if (this.cm(nick) === targetCM) {
						return msg;
					}
					break;
				case irc.ERR_NOSUCHNICK:
					nick = msg.params[1];
					if (this.cm(nick) === targetCM) {
						throw new IRCError(msg);
					}
					break;
			}
		});

		const whois: Record<string, Message> = {};
		for (const reply of endOfWhois.list || []) {
			whois[reply.command] = reply;
		}
		return whois;
	}

	supportsSASL(mech: string): boolean {
		const saslCap = this.caps.available.get("sasl");
		if (saslCap === undefined) {
			return false;
		}
		return saslCap.split(",").includes(mech);
	}

	checkAccountRegistrationCap(k: string): boolean {
		const v = this.caps.available.get("draft/account-registration");
		if (v === undefined) {
			return false;
		}
		return v.split(",").includes(k);
	}

	requestCaps(): void {
		const wantCaps = [...permanentCaps];
		if (!this.params.bouncerNetwork) {
			wantCaps.push("soju.im/bouncer-networks-notify");
		}
		if (this.params.eventPlayback) {
			wantCaps.push("draft/event-playback");
		}

		const msg = this.caps.requestAvailable(wantCaps);
		if (msg) {
			this.send(msg);
		}
	}

	handleCap(msg: Message): void {
		this.caps.parse(msg);

		const subCmd = msg.params[1];
		const args = msg.params.slice(2);
		switch (subCmd) {
			case "LS":
				this.supportsCap = true;
				if (args[0] === "*") {
					break;
				}

				console.log("Available server caps:", this.caps.available);

				this.requestCaps();

				if (this.status !== ClientStatus.REGISTERED) {
					if (this.caps.available.has("sasl")) {
						let promise: Promise<void> | undefined;
						if (this.params.saslPlain) {
							promise = this.authenticate("PLAIN", this.params.saslPlain);
						} else if (this.params.saslExternal) {
							promise = this.authenticate("EXTERNAL");
						} else if (this.params.saslOauthBearer) {
							promise = this.authenticate("OAUTHBEARER", this.params.saslOauthBearer);
						}
						(promise || Promise.resolve()).catch((err) => {
							this.dispatchError(err);
							this.disconnect();
						});
					}

					if (this.caps.available.has("soju.im/bouncer-networks") && this.params.bouncerNetwork) {
						this.send({ command: "BOUNCER", params: ["BIND", this.params.bouncerNetwork] });
					}

					this.send({ command: "CAP", params: ["END"] });
				}
				break;
			case "NEW":
				console.log("Server added available caps:", args[0]);
				this.requestCaps();
				break;
			case "DEL":
				console.log("Server removed available caps:", args[0]);
				break;
			case "ACK":
				console.log("Server ack'ed caps:", args[0]);
				break;
			case "NAK":
				console.log("Server nak'ed caps:", args[0]);
				if (this.status !== ClientStatus.REGISTERED) {
					this.send({ command: "CAP", params: ["END"] });
				}
				break;
		}
	}

	send(msg: OutgoingMessage): void {
		if (!this.ws) {
			throw new Error("Failed to send IRC message " + msg.command + ": socket is closed");
		}
		const raw = irc.formatMessage(msg);
		this.ws.send(raw);
		if (this.debug) {
			console.debug("Sent:", raw);
		}
	}

	updateCaseMapping(): void {
		this.cm = this.isupport.caseMapping();
		this.pendingLists = new irc.CaseMapMap(this.pendingLists, this.cm);
		this.monitored = new irc.CaseMapMap(this.monitored, this.cm);
	}

	isServer(name: string): boolean {
		return name === "*" || this.cm(name) === this.cm(this.serverPrefix.name);
	}

	isMyNick(nick: string): boolean {
		return this.nick !== null && this.cm(nick) === this.cm(this.nick);
	}

	isChannel(name: string): boolean {
		const chanTypes = this.isupport.chanTypes();
		return name.length > 0 && chanTypes.indexOf(name[0]) >= 0;
	}

	isNick(name: string): boolean {
		// A dollar sign is used for server-wide broadcasts
		return !this.isServer(name) && !this.isChannel(name) && !name.startsWith("$");
	}

	setPingInterval(sec: number): void {
		if (this.pingIntervalID) {
			clearInterval(this.pingIntervalID);
		}
		this.pingIntervalID = null;

		if (sec <= 0) {
			return;
		}

		this.pingIntervalID = setInterval(() => {
			if (this.ws) {
				this.send({ command: "PING", params: ["gamja"] });
			}
		}, sec * 1000);
	}

	/* Execute a command that expects a response. `done` is called with message
	 * events until it returns a truthy value. */
	roundtrip<T>(msg: OutgoingMessage, done: (msg: Message) => T | undefined | void | false): Promise<T> {
		const cmd = msg.command;

		let label: string | undefined;
		if (this.caps.enabled.has("labeled-response")) {
			lastLabel++;
			label = String(lastLabel);
			msg.tags = { ...msg.tags, label };
		}

		return new Promise((resolve, reject) => {
			const handleMessage = (event: Event) => {
				const msg = (event as CustomEvent<MessageEventDetail>).detail.message;

				const msgLabel = irc.getMessageLabel(msg);
				if (msgLabel && msgLabel !== label) {
					return;
				}

				let isError = false;
				switch (msg.command) {
					case "FAIL":
						isError = msg.params[0] === cmd;
						break;
					case irc.ERR_UNKNOWNERROR:
					case irc.ERR_UNKNOWNCOMMAND:
					case irc.ERR_NEEDMOREPARAMS:
					case irc.RPL_TRYAGAIN:
						isError = msg.params[1] === cmd;
						break;
				}
				if (isError) {
					removeEventListeners();
					reject(new IRCError(msg));
					return;
				}

				let result;
				try {
					result = done(msg);
				} catch (err) {
					removeEventListeners();
					reject(err);
					return;
				}
				if (result) {
					removeEventListeners();
					resolve(result);
				}
			};

			const handleStatus = () => {
				if (this.status === ClientStatus.DISCONNECTED) {
					removeEventListeners();
					reject(new Error("Connection closed"));
				}
			};

			const removeEventListeners = () => {
				this.removeEventListener("message", handleMessage, { capture: true });
				this.removeEventListener("status", handleStatus);
			};

			// Turn on capture to handle messages before external users and
			// have the opportunity to set the "internal" flag
			this.addEventListener("message", handleMessage, { capture: true });
			this.addEventListener("status", handleStatus);
			try {
				this.send(msg);
			} catch (err) {
				removeEventListeners();
				reject(err);
			}
		});
	}

	async join(channel: string, password?: string): Promise<void> {
		const params = [channel];
		if (password) {
			params.push(password);
		}
		const msg = {
			command: "JOIN",
			params,
		};
		await this.roundtrip(msg, (msg) => {
			switch (msg.command) {
				case irc.ERR_NOSUCHCHANNEL:
				case irc.ERR_TOOMANYCHANNELS:
				case irc.ERR_BADCHANNELKEY:
				case irc.ERR_BANNEDFROMCHAN:
				case irc.ERR_CHANNELISFULL:
				case irc.ERR_INVITEONLYCHAN:
					if (this.cm(msg.params[1]) === this.cm(channel)) {
						throw new IRCError(msg);
					}
					break;
				case "JOIN":
					if (
						msg.prefix &&
						this.isMyNick(msg.prefix.name) &&
						this.cm(msg.params[0]) === this.cm(channel)
					) {
						return true;
					}
					break;
			}
		});
	}

	fetchBatch(msg: OutgoingMessage, batchType: string): Promise<BatchResult> {
		let batchName: string | null = null;
		const messages: Message[] = [];
		return this.roundtrip(msg, (msg) => {
			if (batchName) {
				let batch = msg.batch;
				while (batch) {
					if (batch.name === batchName) {
						messages.push(msg);
						break;
					}
					batch = batch.parent;
				}
			}

			if (msg.command !== "BATCH") {
				return;
			}

			const enter = msg.params[0].startsWith("+");
			const name = msg.params[0].slice(1);
			if (enter && msg.params[1] === batchType) {
				batchName = name;
				return;
			}
			if (!enter && name === batchName) {
				return { ...this.batches.get(name)!, messages };
			}
		});
	}

	roundtripChatHistory(params: (string | number)[]): Promise<Message[]> {
		// Don't send multiple CHATHISTORY commands in parallel, we can't
		// properly handle batches and errors.
		const promise = this.pendingCmds.CHATHISTORY.then(async () => {
			const msg = {
				command: "CHATHISTORY",
				params,
			};
			const batch = await this.fetchBatch(msg, "chathistory");
			return batch.messages;
		});
		this.pendingCmds.CHATHISTORY = promise.catch(() => {});
		return promise;
	}

	/* Fetch one page of history before the given date. */
	async fetchHistoryBefore(
		target: string,
		before: string,
		limit: number,
	): Promise<{ messages: Message[]; more: boolean }> {
		const max = Math.min(limit, this.isupport.chatHistory());
		const params = ["BEFORE", target, "timestamp=" + before, max];
		const messages = await this.roundtripChatHistory(params);
		return { messages, more: messages.length >= max };
	}

	/* Fetch history in ascending order. */
	async fetchHistoryBetween(
		target: string,
		after: { time: string },
		before: { time: string },
		limit: number,
	): Promise<{ messages: Message[] }> {
		const max = Math.min(limit, this.isupport.chatHistory());
		const params = ["AFTER", target, "timestamp=" + after.time, max];
		const messages = await this.roundtripChatHistory(params);
		limit -= messages.length;
		if (limit <= 0) {
			throw new Error("Cannot fetch all chat history: too many messages");
		}
		if (messages.length >= max) {
			// There are still more messages to fetch
			after = { ...after, time: messages[messages.length - 1].tags.time! };
			const rest = await this.fetchHistoryBetween(target, after, before, limit);
			return { messages: [...messages, ...rest.messages] };
		}
		return { messages };
	}

	async fetchHistoryTargets(t1: string, t2: string): Promise<ChatHistoryTarget[]> {
		const msg = {
			command: "CHATHISTORY",
			params: ["TARGETS", "timestamp=" + t1, "timestamp=" + t2, 1000],
		};
		const batch = await this.fetchBatch(msg, "draft/chathistory-targets");
		return batch.messages.map((msg) => {
			console.assert(msg.command === "CHATHISTORY" && msg.params[0] === "TARGETS");
			return {
				name: msg.params[1],
				latestMessage: msg.params[2],
			};
		});
	}

	async listBouncerNetworks(): Promise<Map<string, BouncerNetworkAttrs>> {
		const req = { command: "BOUNCER", params: ["LISTNETWORKS"] };
		const batch = await this.fetchBatch(req, "soju.im/bouncer-networks");
		const networks = new Map<string, BouncerNetworkAttrs>();
		for (const msg of batch.messages) {
			console.assert(msg.command === "BOUNCER" && msg.params[0] === "NETWORK");
			const id = msg.params[1];
			const params = irc.parseTags(msg.params[2]);
			networks.set(id, params);
		}
		return networks;
	}

	monitor(target: string): void {
		if (this.monitored.has(target)) {
			return;
		}

		this.monitored.set(target, true);

		// TODO: add poll-based fallback when MONITOR is not supported
		if (this.monitored.size + 1 > this.isupport.monitor()) {
			return;
		}

		this.send({ command: "MONITOR", params: ["+", target] });
	}

	unmonitor(target: string): void {
		if (!this.monitored.has(target)) {
			return;
		}

		this.monitored.delete(target);

		if (this.isupport.monitor() <= 0) {
			return;
		}

		this.send({ command: "MONITOR", params: ["-", target] });
	}

	createBouncerNetwork(attrs: BouncerNetworkAttrs): Promise<string> {
		const msg = {
			command: "BOUNCER",
			params: ["ADDNETWORK", irc.formatTags(attrs)],
		};
		return this.roundtrip(msg, (msg) => {
			if (msg.command === "BOUNCER" && msg.params[0] === "ADDNETWORK") {
				return msg.params[1];
			}
		});
	}

	registerAccount(
		email: string | null,
		password: string,
	): Promise<{ verificationRequired: boolean; account: string; message: string }> {
		const msg = {
			command: "REGISTER",
			params: ["*", email || "*", password],
		};
		return this.roundtrip(msg, (msg) => {
			if (msg.command !== "REGISTER") {
				return;
			}
			const result = msg.params[0];
			return {
				verificationRequired: result === "VERIFICATION_REQUIRED",
				account: msg.params[1],
				message: msg.params[2],
			};
		});
	}

	verifyAccount(account: string, code: string): Promise<{ message: string }> {
		const msg = {
			command: "VERIFY",
			params: [account, code],
		};
		return this.roundtrip(msg, (msg) => {
			if (msg.command !== "VERIFY") {
				return;
			}
			return { message: msg.params[2] };
		});
	}

	supportsReadMarker(): boolean {
		return this.caps.enabled.has("draft/read-marker");
	}

	fetchReadMarker(target: string): void {
		this.send({
			command: "MARKREAD",
			params: [target],
		});
	}

	setReadMarker(target: string, t: string): void {
		this.send({
			command: "MARKREAD",
			params: [target, "timestamp=" + t],
		});
	}

	async ping(): Promise<void> {
		lastPing++;
		const token = "gamja-" + String(lastPing);
		await this.roundtrip({ command: "PING", params: [token] }, (msg) => {
			return msg.command === "PONG" && msg.params[1] === token;
		});
	}
}
