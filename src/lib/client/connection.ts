/** The connection to the server: its lifecycle, receiving and sending messages. */

import * as irc from "../irc";
import type { Message, OutgoingMessage, Prefix, Batch } from "../irc";
import { Backoff } from "./backoff";
import { WEBSOCKET_CLOSE_CODES, WebSocketError } from "./errors";
import { handleMessage } from "./incoming";
import {
	listenSocket,
	openSocket,
	RECONNECT_MAX_DELAY_MSEC,
	RECONNECT_MIN_DELAY_MSEC,
	scheduleReconnect,
	sendRegistration,
} from "./lifecycle";
import { handlePongTimeout, scheduleLagCheck, setPingInterval, startRegistrationTimeout } from "./keepalive";
import { sendPendingMonitor } from "./monitor";
import { assembleMultiline, expandMultiline, type MultilineBatches } from "./multiline";
import { Multiplexer } from "./multiplex";
import { redactForLog } from "./redact";
import { roundtrip } from "./roundtrip";
import { ClientStatus, type ClientParams } from "./types";

const FALLBACK_SERVER_PREFIX: Prefix = { name: "*" };

/** The parts of a WebSocket a connection uses, which a VirtualSocket has too. */
export interface Socket {
	send(data: string): void;
	close(code?: number): void;
	addEventListener(type: "open" | "message" | "close", listener: (event: Event) => void): void;
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
	ws: Socket | null = null;
	/** The networks attached to this bouncer connection, see multiplex.ts */
	multiplexer: Multiplexer | null = null;
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
		multiplexer: null,
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
		if (this.params.multiplexer) {
			console.log("Attaching bouncer network " + this.params.bouncerNetwork);
		} else {
			console.log("Connecting to " + this.params.url);
		}
		this.setStatus(ClientStatus.CONNECTING);
		this.lastReconnectDate = new Date();

		const ws = openSocket(this);
		if (ws) {
			this.ws = ws;
			listenSocket(this, ws);
		}
	}

	/**
	 * Handle the end of a connection. Called on the close event, or directly
	 * when the socket is deemed dead: the close event may then come much
	 * later, if ever.
	 */
	handleClose(ws: Socket, code: number): void {
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
				scheduleReconnect(this);
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

	/** See keepalive.ts */
	scheduleLagCheck(delay: number): void {
		scheduleLagCheck(this, delay);
	}

	handlePongTimeout(ws: Socket): void {
		handlePongTimeout(this, ws);
	}

	/**
	 * Close the socket and reconnect, unlike disconnect(). The close event may
	 * never come on a dead connection: handle it now, with the code to report.
	 */
	dropConnection(ws: Socket, code: number): void {
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

		const mux = this.params.multiplexer;
		// An attached network shares the bouncer connection's socket, which
		// is kept alive by the bouncer connection
		this.setPingInterval(mux ? 0 : this.params.ping || 0);
		startRegistrationTimeout(this, this.ws!);

		this.nick = this.params.nick;

		if (mux) {
			// Registered by the bouncer once attached, with the caps of the
			// bouncer connection
			this.supportsCap = true;
			this.caps = mux.inheritedCaps();
			return;
		}

		sendRegistration(this, this.nick);
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

	/** See incoming.ts */
	handleMessage(event: MessageEvent): void {
		handleMessage(this, event);
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
		setPingInterval(this, sec);
	}

	/** The multiplexer of this bouncer connection, created on first use. */
	getMultiplexer(): Multiplexer {
		this.multiplexer ??= new Multiplexer(this);
		return this.multiplexer;
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
		sendPendingMonitor(this);
	}

	// Implemented by RegistrationClient
	abstract handleCap(msg: Message): void;
	abstract wantsSASL(): boolean;
	abstract syncAway(): void;
}
