import { ReceiptType, Unread } from "../state";
import debounce from "../lib/debounce";
import { CaseMapping } from "../lib/irc";
import { Item } from "./item";
import {
	parseStoredBuffer,
	storedServer,
	sameServer,
	mergeReceipts,
	mergeStoredBuffers,
	type StoredBuffer,
	type ServerRef,
	type StoredServer,
	type BufferUpdate,
	type Receipts,
} from "./model";

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
		if (
			(event.key === this.raw.k || event.key === null) &&
			(!event.storageArea || event.storageArea === localStorage)
		) {
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
		if (this.raw.put(this.m.size > 0 ? Object.fromEntries(this.m) : null)) {
			this.dirty.clear();
		}
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
