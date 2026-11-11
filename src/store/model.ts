/** Persisted buffer schemas, validation, identity and receipt merging. */

import { ReceiptType, Unread, unionUnread, type Receipt } from "../state";
import type { CaseMapFn } from "../lib/irc";

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
export function parseStoredBuffer(v: unknown): StoredBuffer | null {
	if (typeof v !== "object" || v === null) {
		return null;
	}
	const buf = v as Partial<StoredBuffer>;
	if (typeof buf.name !== "string" || typeof buf.server !== "object" || buf.server === null) {
		return null;
	}
	if (
		[buf.server.url, buf.server.bouncerNetwork].some(
			(v) => v !== null && v !== undefined && typeof v !== "string",
		)
	) {
		return null;
	}
	const receipts: Receipts = {};
	for (const type of Object.values(ReceiptType)) {
		const receipt = buf.receipts?.[type];
		if (typeof receipt?.time === "string" && receipt.time && Number.isFinite(Date.parse(receipt.time))) {
			receipts[type] = { time: receipt.time };
		}
	}
	return {
		name: buf.name,
		unread: Object.values(Unread).includes(buf.unread as Unread) ? buf.unread! : Unread.NONE,
		receipts,
		closed: buf.closed === true,
		server: storedServer(buf.server),
	};
}

export function storedServer(server: StoredServer): StoredBuffer["server"] {
	return { url: server.url ?? null, bouncerNetwork: server.bouncerNetwork ?? null };
}

export function sameServer(a: StoredServer, b: StoredServer): boolean {
	return (a.url ?? null) === (b.url ?? null) && (a.bouncerNetwork ?? null) === (b.bouncerNetwork ?? null);
}

/** Merge receipts into others, keeping the newest. Returns true if any
 * changed. */
export function mergeReceipts(into: Receipts, from: Receipts): boolean {
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
export function mergeStoredBuffers(a: StoredBuffer, b: StoredBuffer): StoredBuffer {
	const receipts: Receipts = { ...a.receipts };
	mergeReceipts(receipts, b.receipts);
	return {
		...a,
		unread: unionUnread(a.unread, b.unread),
		receipts,
		closed: a.closed && b.closed,
	};
}
