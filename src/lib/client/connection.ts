/** The connection to the server: its lifecycle, receiving and sending messages. */

import * as irc from "../irc";
import type { Message, OutgoingMessage, Prefix, Batch } from "../irc";
import { Backoff } from "./backoff";
import { WEBSOCKET_CLOSE_CODES, WebSocketError, IRCError } from "./errors";
import { assembleMultiline, expandMultiline, type MultilineBatches } from "./multiline";
import { roundtrip } from "./roundtrip";
import { ClientStatus, type ClientParams, type MessageEventDetail } from "./types";

const RECONNECT_MIN_DELAY_MSEC = 10 * 1000; // 10s
const LAG_FIRST_DELAY_MSEC = 2 * 1000;
const LAG_INTERVAL_MSEC = 30 * 1000;
const LAG_TOKEN_PREFIX = "gamja-lag-";
// Without a PONG by then, the connection is considered dead: browsers take a
// long time to notice a TCP connection silently dropped by the network
const PONG_TIMEOUT_MSEC = 60 * 1000;
const REGISTRATION_TIMEOUT_MSEC = 60 * 1000;
const RECONNECT_MAX_DELAY_MSEC = 10 * 60 * 1000; // 10min

const FALLBACK_SERVER_PREFIX: Prefix = { name: "*" };

const REDACTED = "<redacted>";
// AUTHENTICATE parameters worth logging: mechanism names, empty responses,
// aborts. Anything else is a base64-encoded credential.
const SASL_LOGGABLE = /^(\+|\*|PLAIN|EXTERNAL|OAUTHBEARER|SCRAM-[A-Z0-9-]+)$/;

/** Hide passwords, SASL payloads and verification codes from debug logs. */
function redactForLog(msg: OutgoingMessage): OutgoingMessage {
	const params = msg.params ?? [];
	switch (msg.command.toUpperCase()) {
		case "PASS":
			return { ...msg, params: params.map(() => REDACTED) };
		case "AUTHENTICATE":
			return { ...msg, params: params.map((p) => (SASL_LOGGABLE.test(String(p)) ? p : REDACTED)) };
		case "REGISTER":
		case "VERIFY":
			// REGISTER <account> <email> <password>, VERIFY <account> <code>
			return { ...msg, params: params.map((p, i) => (i === params.length - 1 ? REDACTED : p)) };
	}
	return msg;
}

/**
 * The connection part of Client. State lives here: subclasses don't declare
 * fields, which would be reset after this constructor starts connecting.
 */
export abstract class ClientConnection extends EventTarget {
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
	/** draft/multiline batches being received: their BATCH command and lines */
	multilineBatches: MultilineBatches = new Map();
	lastBatchRef = 0;
	autoReconnect = true;
	reconnectTimeoutID: ReturnType<typeof setTimeout> | null = null;
	reconnectBackoff = new Backoff(RECONNECT_MIN_DELAY_MSEC, RECONNECT_MAX_DELAY_MSEC);
	lastReconnectDate = new Date(0);
	pingIntervalID: ReturnType<typeof setInterval> | null = null;
	/** When the next reconnection attempt happens, in ms since the epoch */
	reconnectAt: number | null = null;
	/** Round-trip time to the server, in ms, null until measured */
	lag: number | null = null;
	lagTimeoutID: ReturnType<typeof setTimeout> | undefined;
	pendingCmds: Record<string, Promise<unknown>> = {
		WHO: Promise.resolve(null),
		CHATHISTORY: Promise.resolve(null),
	};
	cm: irc.CaseMapFn = irc.CaseMapping.RFC1459;
	/** Monitored targets, true once sent to the server, false while pending */
	monitored = new irc.CaseMapMap<boolean>(null, irc.CaseMapping.RFC1459);
	/** Size of the server's monitor list, if smaller than advertised */
	monitorLimit = Infinity;
	pendingLists = new irc.CaseMapMap<Message[]>(null, irc.CaseMapping.RFC1459);
	whoxQueries = new Map<string, string>();
	/** Message handlers of pending roundtrips */
	roundtripHandlers = new Set<(msg: Message) => void>();
	/** Whether the user is at the client, e.g. the page is visible */
	present = true;
	/** Away message set by the user, it takes precedence over presence */
	awayMessage: string | null = null;
	/** Away message last sent on this connection, undefined if unknown */
	sentAway: string | null | undefined = null;

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

		this.setReconnectAt(null);
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
		// Events of a socket we've already replaced or closed are ignored: its
		// state was reset when it stopped being the current one
		ws.addEventListener("open", () => {
			if (this.ws === ws) {
				this.handleOpen();
			}
		});

		ws.addEventListener("message", (event) => {
			if (this.ws !== ws) {
				return;
			}
			try {
				this.handleMessage(event);
			} catch (err) {
				// Skip the offending line instead of dropping the connection
				console.error("Failed to handle message:", event.data, err);
				this.dispatchError(err);
			}
		});

		ws.addEventListener("close", (event) => {
			this.handleClose(ws, event.code);
		});
	}

	/**
	 * Handle the end of a connection. Called on the close event, or directly
	 * when the socket is deemed dead: the close event may then come much
	 * later, if ever.
	 */
	handleClose(ws: WebSocket, code: number): void {
		if (this.ws !== ws) {
			return;
		}
		console.log("Connection closed (code: " + code + ")");

		if (code !== WEBSOCKET_CLOSE_CODES.NORMAL_CLOSURE && code !== WEBSOCKET_CLOSE_CODES.GOING_AWAY) {
			this.dispatchError(new WebSocketError(code));
		}

		this.resetConnection();

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
				this.setReconnectAt(Date.now() + delay);
			}
		}
	}

	/** Forget the state of the current connection, once its socket is gone. */
	resetConnection(): void {
		this.ws = null;
		this.setStatus(ClientStatus.DISCONNECTED);
		this.nick = null;
		this.serverPrefix = FALLBACK_SERVER_PREFIX;
		this.supportsCap = false;
		this.caps = new irc.CapRegistry();
		this.batches = new Map();
		this.multilineBatches = new Map();
		Object.keys(this.pendingCmds).forEach((k) => {
			this.pendingCmds[k] = Promise.resolve(null);
		});
		this.isupport = new irc.Isupport();
		this.cm = irc.CaseMapping.RFC1459;
		this.monitored = new irc.CaseMapMap(null, this.cm);
		this.monitorLimit = Infinity;
		this.pendingLists = new irc.CaseMapMap(null, this.cm);
		this.whoxQueries = new Map();
		this.sentAway = null;
		clearTimeout(this.lagTimeoutID);
		this.setLag(null);
	}

	setReconnectAt(t: number | null): void {
		if (this.reconnectAt !== t) {
			this.reconnectAt = t;
			this.dispatchEvent(new CustomEvent("reconnect"));
		}
	}

	setLag(lag: number | null): void {
		if (this.lag !== lag) {
			this.lag = lag;
			this.dispatchEvent(new CustomEvent("lag"));
		}
	}

	/**
	 * Measure the lag now and then, the PONG tells how long it took. This also
	 * checks that the connection is alive: the PONG must come in time.
	 */
	scheduleLagCheck(delay: number): void {
		clearTimeout(this.lagTimeoutID);
		this.lagTimeoutID = setTimeout(() => {
			const ws = this.ws;
			if (this.status !== ClientStatus.REGISTERED || !ws) {
				return;
			}
			this.send({ command: "PING", params: [LAG_TOKEN_PREFIX + Date.now()] });
			// Cleared by the PONG, which schedules the next check
			this.lagTimeoutID = setTimeout(() => {
				this.handlePongTimeout(ws);
			}, PONG_TIMEOUT_MSEC);
		}, delay);
	}

	handlePongTimeout(ws: WebSocket): void {
		if (this.ws !== ws) {
			return;
		}
		console.warn(`No PONG in ${PONG_TIMEOUT_MSEC / 1000} seconds, dropping the connection`);
		this.dropConnection(ws, WEBSOCKET_CLOSE_CODES.ABNORMAL_CLOSURE);
	}

	/**
	 * Close the socket and reconnect, unlike disconnect(). The close event may
	 * never come on a dead connection: handle it now, with the code to report.
	 */
	dropConnection(ws: WebSocket, code: number): void {
		ws.close();
		this.handleClose(ws, code);
	}

	disconnect(): void {
		this.autoReconnect = false;

		if (this.reconnectTimeoutID) {
			clearTimeout(this.reconnectTimeoutID);
		}
		this.reconnectTimeoutID = null;

		globalThis.removeEventListener?.("online", this.handleOnline);
		this.setReconnectAt(null);

		this.setPingInterval(0);

		const ws = this.ws;
		if (ws) {
			// Reset now rather than on the close event, which comes later: a
			// reconnect() may have started a new connection by then
			this.resetConnection();
			ws.close(WEBSOCKET_CLOSE_CODES.NORMAL_CLOSURE);
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

		this.setPingInterval(this.params.ping || 0);
		// The PONG checks only start once registered: a server or proxy which
		// never replies would leave us registering forever. Cleared on
		// RPL_WELCOME by scheduleLagCheck().
		const ws = this.ws!;
		clearTimeout(this.lagTimeoutID);
		this.lagTimeoutID = setTimeout(() => {
			if (this.ws === ws && this.status !== ClientStatus.REGISTERED) {
				console.warn(
					`Not registered in ${REGISTRATION_TIMEOUT_MSEC / 1000} seconds, dropping the connection`,
				);
				this.dropConnection(ws, WEBSOCKET_CLOSE_CODES.ABNORMAL_CLOSURE);
			}
		}, REGISTRATION_TIMEOUT_MSEC);

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
			// Browsers don't let clients close with 1003, only 1000 and 3000-4999
			this.dropConnection(this.ws!, WEBSOCKET_CLOSE_CODES.UNSUPPORTED_DATA);
			return;
		}

		const raw = event.data;
		if (this.debug) {
			console.debug("Received:", raw);
		}

		const msg = this.assembleMultiline(irc.parseMessage(raw));
		if (!msg) {
			return;
		}

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
				if (this.wantsSASL() && !this.supportsCap) {
					this.dispatchError(new Error("Server doesn't support SASL"));
					this.disconnect();
					return;
				}

				if (msg.prefix) {
					this.serverPrefix = msg.prefix;
				}
				this.nick = msg.params[0];

				console.log("Registration complete");
				// Not on open: a gateway may accept the socket, then fail to
				// reach the IRC server, and must be retried less and less
				this.reconnectBackoff.reset();
				this.setStatus(ClientStatus.REGISTERED);
				// Restore the away status without draft/pre-away
				this.syncAway();
				this.scheduleLagCheck(LAG_FIRST_DELAY_MSEC);
				break;
			case irc.RPL_ISUPPORT: {
				const tokens = msg.params.slice(1, -1);
				this.isupport.parse(tokens);
				this.updateCaseMapping();
				// The server may have started supporting MONITOR
				this.sendPendingMonitor();
				break;
			}
			case irc.ERR_MONLISTFULL: {
				// The list is shorter than advertised, e.g. shared with other
				// clients by a bouncer: wait for unmonitor() to make room
				for (const target of (msg.params[2] ?? "").split(",")) {
					if (this.monitored.has(target)) {
						this.monitored.set(target, false);
					}
				}
				this.monitorLimit = Array.from(this.monitored.values()).filter((sent) => sent).length;
				msg.internal = true;
				break;
			}
			case "CAP":
				this.handleCap(msg);
				break;
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
				// The token is required, but some servers omit it
				this.send({ command: "PONG", params: msg.params.slice(0, 1) });
				break;
			case "PONG": {
				const token = msg.params[1] ?? "";
				if (token.startsWith(LAG_TOKEN_PREFIX)) {
					const sent = parseInt(token.slice(LAG_TOKEN_PREFIX.length), 10);
					if (!Number.isNaN(sent)) {
						this.setLag(Math.max(0, Date.now() - sent));
					}
					this.scheduleLagCheck(LAG_INTERVAL_MSEC);
				}
				break;
			}
			case "NICK": {
				const newNick = msg.params[0];
				if (this.isMyNick(msg.prefix.name)) {
					this.nick = newNick;
				}
				break;
			}
			case "BATCH": {
				const { start, name } = irc.parseBatchRef(msg);
				if (start) {
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
			case "ERROR": {
				// Sent before closing the link, e.g. on server restarts and ping
				// timeouts: keep reconnecting. Fatal registration errors come
				// before, as numerics.
				this.dispatchError(new IRCError(msg));
				const ws = this.ws;
				if (ws) {
					this.dropConnection(ws, WEBSOCKET_CLOSE_CODES.NORMAL_CLOSURE);
				}
				break;
			}
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

		// Pending roundtrips first: they may mark the message as internal. A
		// capture listener wouldn't do: browsers call the listeners of a plain
		// EventTarget in the order they were added.
		// Copied, handlers remove themselves once done
		if (this.roundtripHandlers.size > 0) {
			for (const handler of [...this.roundtripHandlers]) {
				handler(msg);
			}
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

	/**
	 * Assemble a draft/multiline batch into a single PRIVMSG or NOTICE whose
	 * text contains line breaks. Returns null while the batch is incomplete,
	 * and the message itself if it isn't part of such a batch.
	 */
	assembleMultiline(msg: Message): Message | null {
		return assembleMultiline(this.multilineBatches, msg);
	}

	/**
	 * Expand a PRIVMSG or NOTICE whose text contains line breaks into a
	 * draft/multiline batch, or into one message per line if the server
	 * doesn't support it.
	 */
	expandMultiline(msg: OutgoingMessage): OutgoingMessage[] {
		return expandMultiline(msg, {
			isupport: this.isupport,
			nick: this.nick ?? "*",
			supportsMultiline: this.supportsMultiline(),
			nextBatchRef: () => String(++this.lastBatchRef),
		});
	}

	supportsMultiline(): boolean {
		return this.caps.enabled.has("batch") && this.caps.enabled.has(irc.MULTILINE_BATCH_TYPE);
	}

	/** The draft/multiline limits of the server, null if unsupported. */
	multilineLimits(): irc.MultilineLimits | null {
		if (!this.supportsMultiline()) {
			return null;
		}
		return irc.parseMultilineCap(this.caps.available.get(irc.MULTILINE_BATCH_TYPE));
	}

	send(msg: OutgoingMessage): void {
		if (!this.ws) {
			throw new Error("Failed to send IRC message " + msg.command + ": socket is closed");
		}
		// Format all the messages first, not to send a partial batch
		const msgs = this.expandMultiline(msg);
		const raws = msgs.map((m) => irc.formatMessage(m));
		for (const [i, raw] of raws.entries()) {
			this.ws.send(raw);
			if (this.debug) {
				console.debug("Sent:", irc.formatMessage(redactForLog(msgs[i])));
			}
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

	/** Execute a command that expects a response, see roundtrip(). */
	roundtrip<T>(
		msg: OutgoingMessage,
		done: (msg: Message) => T | undefined | void | false,
		timeout?: number,
	): Promise<T> {
		return roundtrip(this, msg, done, timeout);
	}

	/** Send the pending monitored targets, as far as the server's limit allows. */
	sendPendingMonitor(): void {
		let room = Math.min(this.isupport.monitor(), this.monitorLimit);
		const pending: string[] = [];
		for (const [target, sent] of this.monitored) {
			if (sent) {
				room--;
			} else {
				pending.push(target);
			}
		}
		const targets = pending.slice(0, Math.max(0, room));
		if (targets.length === 0) {
			return;
		}
		for (const target of targets) {
			this.monitored.set(target, true);
		}
		for (const chunk of irc.chunkTargets(targets, this.isupport.targMax("MONITOR"))) {
			this.send({ command: "MONITOR", params: ["+", chunk.join(",")] });
		}
	}

	// Implemented by RegistrationClient
	abstract handleCap(msg: Message): void;
	abstract wantsSASL(): boolean;
	abstract syncAway(): void;
}
