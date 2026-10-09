import { ReceiptType, Unread, type Receipt } from "./state";
import debounce from "./lib/debounce";

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
export interface StoredConnectParams {
	url?: string | null;
	pass?: string | null;
	username?: string | null;
	realname?: string | null;
	nick?: string | null;
	saslPlain?: { username: string; password: string } | null;
	saslExternal?: boolean;
	saslOauthBearer?: { token: string; username?: string | null } | null;
	autoconnect?: boolean;
	autojoin?: string[];
	ping?: number;
}

export const autoconnect = new Item<StoredConnectParams>("autoconnect");
export const naggedProtocolHandler = new Item<boolean>("naggedProtocolHandler");
export const settings = new Item<Record<string, unknown>>("settings");
/** Reactions picked last, most recent first */
export const recentReactions = new Item<string[]>("recentReactions");

export interface StoredServer {
	bouncerNetwork?: string | null;
}

export type Receipts = Partial<Record<ReceiptType, Receipt>>;

export interface StoredBuffer {
	name: string;
	unread: Unread;
	receipts: Receipts;
	closed: boolean;
	server: StoredServer;
}

export interface BufferUpdate {
	name: string;
	server: StoredServer;
	unread?: Unread;
	receipts?: Receipts;
	closed?: boolean;
}

/** Per-buffer state persisted across sessions: unread status and receipts. */
export class BufferStore {
	raw = new Item<Record<string, StoredBuffer>>("buffers");
	m: Map<string, StoredBuffer>;
	save: () => void;

	constructor() {
		const obj = this.raw.load();
		this.m = new Map(Object.entries(obj || {}));

		const saveImmediately = this.saveImmediately.bind(this);
		this.save = debounce(saveImmediately, 500);

		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") {
				saveImmediately();
			}
		});
	}

	key(buf: { name: string; server: StoredServer }): string {
		// TODO: use case-mapping here somehow
		return JSON.stringify({
			name: buf.name.toLowerCase(),
			server: {
				bouncerNetwork: buf.server.bouncerNetwork,
			},
		});
	}

	saveImmediately(): void {
		if (this.m.size > 0) {
			this.raw.put(Object.fromEntries(this.m));
		} else {
			this.raw.put(null);
		}
	}

	get(buf: { name: string; server: StoredServer }): StoredBuffer | undefined {
		return this.m.get(this.key(buf));
	}

	/** Merge an update into the stored buffer. Returns true if anything changed. */
	put(buf: BufferUpdate): boolean {
		const key = this.key(buf);

		let updated = !this.m.has(key);
		const prev: Partial<StoredBuffer> = this.m.get(key) || {};

		let unread = prev.unread || Unread.NONE;
		if (buf.unread !== undefined && buf.unread !== prev.unread) {
			unread = buf.unread;
			updated = true;
		}

		const receipts: Receipts = { ...prev.receipts };
		if (buf.receipts) {
			for (const k of Object.keys(buf.receipts) as ReceiptType[]) {
				const r = buf.receipts[k];
				if (!r) {
					continue;
				}
				const cur = receipts[k];
				if (!cur || cur.time < r.time) {
					receipts[k] = r;
					updated = true;
				}
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

		this.m.set(key, {
			name: buf.name,
			unread,
			receipts,
			closed,
			server: {
				bouncerNetwork: buf.server.bouncerNetwork,
			},
		});

		this.save();
		return true;
	}

	delete(buf: { name: string; server: StoredServer }): void {
		this.m.delete(this.key(buf));
		this.save();
	}

	list(server: StoredServer): StoredBuffer[] {
		// Some gamja versions would store the same buffer multiple times
		const names = new Set<string>();
		const buffers: StoredBuffer[] = [];
		for (const buf of this.m.values()) {
			if ((buf.server.bouncerNetwork ?? null) !== (server.bouncerNetwork ?? null)) {
				continue;
			}
			if (names.has(buf.name)) {
				continue;
			}
			buffers.push(buf);
			names.add(buf.name);
		}
		return buffers;
	}

	clear(server?: StoredServer): void {
		if (server) {
			for (const buf of this.list(server)) {
				this.m.delete(this.key(buf));
			}
		} else {
			this.m = new Map();
		}
		this.save();
	}
}
