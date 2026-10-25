import { ReceiptType, Unread, sanitizeSettings, unionUnread, type Receipt } from "./state";
import debounce from "./lib/debounce";
import { CaseMapping, type CaseMapFn } from "./lib/irc";

const PREFIX = "gamja_";

export class Item<T> {
	k: string;

	constructor(k: string) {
		this.k = PREFIX + k;
	}

	load(): T | null {
		let v: string | null;
		try {
			v = localStorage.getItem(this.k);
		} catch (_err) {
			return null; // Storage disabled
		}
		if (!v) {
			return null;
		}
		try {
			return JSON.parse(v) as T;
		} catch (err) {
			console.error(`Failed to parse stored ${this.k}:`, err);
			return null;
		}
	}

	put(v: T | null | undefined): void {
		try {
			if (v) {
				localStorage.setItem(this.k, JSON.stringify(v));
			} else {
				localStorage.removeItem(this.k);
			}
		} catch (err) {
			console.error(`Failed to store ${this.k}:`, err);
		}
	}
}

/** Connection parameters stored by "Remember me". */
interface StoredConnectParams {
	url?: string | null;
	pass?: string | null;
	username?: string | null;
	realname?: string | null;
	nick?: string | null;
	saslPlain?: { username: string; password: string } | null;
	saslExternal?: boolean;
	saslOauthBearer?: { token: string; username?: string | null; expiresAt?: number | null } | null;
	autoconnect?: boolean;
	autojoin?: string[];
	ping?: number;
}

export const autoconnect = new Item<StoredConnectParams>("autoconnect");
export const naggedProtocolHandler = new Item<boolean>("naggedProtocolHandler");
/** Settings changed from their defaults. Loading drops invalid ones, see
 * sanitizeSettings(). */
class SettingsItem extends Item<Record<string, unknown>> {
	override load(): Record<string, unknown> | null {
		const stored = super.load();
		return stored === null ? null : sanitizeSettings(stored);
	}
}

export const settings = new SettingsItem("settings");
/** Keys of the networks collapsed in the buffer list, see getServerKey() */
export const collapsedNetworks = new Item<string[]>("collapsedNetworks");
/** Whether the buffer list is hidden on large screens */
export const bufferListHidden = new Item<boolean>("bufferListHidden");
/** Reactions picked last, most recent first */
export const recentReactions = new Item<string[]>("recentReactions");

export interface StoredServer {
	/** WebSocket URL, null for buffers stored by older gamja versions */
	url?: string | null;
	bouncerNetwork?: string | null;
}

/** A server whose buffers are looked up, with its case-mapping */
export interface ServerRef extends StoredServer {
	cm?: CaseMapFn;
}

export type Receipts = Partial<Record<ReceiptType, Receipt>>;

export interface StoredBuffer {
	name: string;
	unread: Unread;
	receipts: Receipts;
	closed: boolean;
	server: { url: string | null; bouncerNetwork: string | null };
}

export interface BufferUpdate {
	name: string;
	server: ServerRef;
	unread?: Unread;
	receipts?: Receipts;
	closed?: boolean;
}

/** The stored buffer, or null if it isn't one, e.g. corrupted. */
function parseStoredBuffer(v: unknown): StoredBuffer | null {
	if (typeof v !== "object" || v === null) {
		return null;
	}
	const buf = v as Partial<StoredBuffer>;
	if (typeof buf.name !== "string" || typeof buf.server !== "object" || buf.server === null) {
		return null;
	}
	return {
		name: buf.name,
		unread: Object.values(Unread).includes(buf.unread as Unread) ? buf.unread! : Unread.NONE,
		receipts: typeof buf.receipts === "object" && buf.receipts !== null ? buf.receipts : {},
		closed: buf.closed === true,
		server: storedServer(buf.server),
	};
}

function storedServer(server: StoredServer): StoredBuffer["server"] {
	return { url: server.url ?? null, bouncerNetwork: server.bouncerNetwork ?? null };
}

function sameServer(a: StoredServer, b: StoredServer): boolean {
	return (a.url ?? null) === (b.url ?? null) && (a.bouncerNetwork ?? null) === (b.bouncerNetwork ?? null);
}

/** Merge receipts into others, keeping the newest. Returns true if any
 * changed. */
function mergeReceipts(into: Receipts, from: Receipts): boolean {
	let changed = false;
	for (const k of Object.keys(from) as ReceiptType[]) {
		const r = from[k];
		const cur = into[k];
		if (r && (!cur || cur.time < r.time)) {
			into[k] = r;
			changed = true;
		}
	}
	return changed;
}

/** Merge two stored copies of the same buffer, keeping the newest receipts. */
function mergeStoredBuffers(a: StoredBuffer, b: StoredBuffer): StoredBuffer {
	const receipts: Receipts = { ...a.receipts };
	mergeReceipts(receipts, b.receipts);
	return {
		...a,
		unread: unionUnread(a.unread, b.unread),
		receipts,
		closed: a.closed && b.closed,
	};
}

/**
 * Per-buffer state persisted across sessions: unread status and receipts.
 *
 * Buffers are stored per server (WebSocket URL and bouncer network), and
 * looked up with the server's case-mapping. Other tabs share the storage:
 * saving merges the buffers changed here into the stored ones, instead of
 * overwriting those changed elsewhere.
 */
export class BufferStore {
	raw = new Item<Record<string, StoredBuffer>>("buffers");
	m: Map<string, StoredBuffer>;
	/** Keys of the buffers changed or deleted here since the last save */
	dirty = new Set<string>();
	save: () => void;
	onVisibilityChange = () => {
		if (document.visibilityState === "hidden") {
			this.saveImmediately();
		}
	};
	onStorage = (event: StorageEvent) => {
		if (event.key === this.raw.k) {
			this.m = this.merged();
		}
	};

	constructor() {
		this.m = this.load();
		this.save = debounce(this.saveImmediately.bind(this), 500);

		document.addEventListener("visibilitychange", this.onVisibilityChange);
		window.addEventListener("storage", this.onStorage);
	}

	/** Stop saving when the page is hidden, and following other tabs. */
	dispose(): void {
		document.removeEventListener("visibilitychange", this.onVisibilityChange);
		window.removeEventListener("storage", this.onStorage);
	}

	/** The stored buffers, under their current key. */
	load(): Map<string, StoredBuffer> {
		// Keys are recomputed: older gamja versions could store a buffer
		// under several keys, see key()
		const m = new Map<string, StoredBuffer>();
		for (const v of Object.values(this.raw.load() ?? {})) {
			const buf = parseStoredBuffer(v);
			if (!buf) {
				continue;
			}
			const key = this.key(buf);
			const prev = m.get(key);
			m.set(key, prev ? mergeStoredBuffers(prev, buf) : buf);
		}
		return m;
	}

	/** The stored buffers, with the changes made here applied. */
	merged(): Map<string, StoredBuffer> {
		const m = this.load();
		for (const key of this.dirty) {
			const ours = this.m.get(key);
			const theirs = m.get(key);
			if (!ours) {
				m.delete(key);
			} else if (theirs) {
				// Ours is the latest unread and closed state, receipts only
				// move forward
				const receipts = { ...ours.receipts };
				mergeReceipts(receipts, theirs.receipts);
				m.set(key, { ...ours, receipts });
			} else {
				m.set(key, ours);
			}
		}
		return m;
	}

	key(buf: { name: string; server: StoredServer }): string {
		// A missing bouncer network is the same as none: undefined and null
		// must give the same key
		return JSON.stringify({ name: buf.name, server: storedServer(buf.server) });
	}

	saveImmediately(): void {
		if (this.dirty.size === 0) {
			return;
		}
		this.m = this.merged();
		this.dirty.clear();
		this.raw.put(this.m.size > 0 ? Object.fromEntries(this.m) : null);
	}

	set(key: string, buf: StoredBuffer | null): void {
		if (buf) {
			this.m.set(key, buf);
		} else {
			this.m.delete(key);
		}
		this.dirty.add(key);
		this.save();
	}

	/**
	 * The keys of the buffers of a server. Those stored without a URL by
	 * older versions now belong to it. Copies of a buffer under names equal
	 * per the case-mapping are merged.
	 */
	keys(server: ServerRef): Map<string, string> {
		const cm = server.cm ?? CaseMapping.RFC1459;
		const keys = new Map<string, string>();
		for (const [key, buf] of [...this.m]) {
			let stored = buf;
			if (!sameServer(stored.server, server)) {
				if (
					stored.server.url !== null ||
					!server.url ||
					!sameServer(stored.server, { ...server, url: null })
				) {
					continue;
				}
				stored = { ...stored, server: storedServer(server) };
				this.set(key, null);
			}
			const name = cm(stored.name);
			const prevKey = keys.get(name);
			if (prevKey !== undefined) {
				this.set(prevKey, mergeStoredBuffers(this.m.get(prevKey)!, stored));
				if (stored === buf) {
					this.set(key, null);
				}
				continue;
			}
			const storedKey = this.key(stored);
			if (stored !== buf) {
				this.set(storedKey, stored);
			}
			keys.set(name, storedKey);
		}
		return keys;
	}

	find(buf: { name: string; server: ServerRef }): string | undefined {
		const cm = buf.server.cm ?? CaseMapping.RFC1459;
		return this.keys(buf.server).get(cm(buf.name));
	}

	get(buf: { name: string; server: ServerRef }): StoredBuffer | undefined {
		const key = this.find(buf);
		return key === undefined ? undefined : this.m.get(key);
	}

	/** Merge an update into the stored buffer. Returns true if anything changed. */
	put(buf: BufferUpdate): boolean {
		let key = this.find(buf);

		let updated = key === undefined;
		const prev: Partial<StoredBuffer> = (key !== undefined && this.m.get(key)) || {};
		key ??= this.key(buf);

		let unread = prev.unread || Unread.NONE;
		if (buf.unread !== undefined && buf.unread !== prev.unread) {
			unread = buf.unread;
			updated = true;
		}

		const receipts: Receipts = { ...prev.receipts };
		if (buf.receipts) {
			if (mergeReceipts(receipts, buf.receipts)) {
				updated = true;
			}
			const delivered = receipts[ReceiptType.DELIVERED];
			const read = receipts[ReceiptType.READ];
			if (read && (!delivered || delivered.time < read.time)) {
				receipts[ReceiptType.DELIVERED] = read;
				updated = true;
			}
		}

		let closed = prev.closed || false;
		if (buf.closed !== undefined && buf.closed !== prev.closed) {
			closed = buf.closed;
			updated = true;
		}

		if (!updated) {
			return false;
		}

		this.set(key, {
			// Keep the name it was first stored with
			name: prev.name ?? buf.name,
			unread,
			receipts,
			closed,
			server: storedServer(buf.server),
		});
		return true;
	}

	delete(buf: { name: string; server: ServerRef }): void {
		const key = this.find(buf);
		if (key !== undefined) {
			this.set(key, null);
		}
	}

	list(server: ServerRef): StoredBuffer[] {
		return [...this.keys(server).values()].map((key) => this.m.get(key)!);
	}

	clear(server?: ServerRef): void {
		const keys = server ? [...this.keys(server).values()] : [...this.m.keys()];
		for (const key of keys) {
			this.set(key, null);
		}
	}
}
