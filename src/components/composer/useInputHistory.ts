import { useMemo, useRef } from "react";

/** How many sent messages each buffer remembers */
const HISTORY_SIZE = 100;

export interface InputHistory {
	/** Remember a sent message, and stop browsing */
	add(key: unknown, text: string): void;
	/**
	 * Recall an older (-1) or newer (1) sent message of a buffer, returns
	 * null if there's none. Browsing past the newest one gives back the
	 * text typed before browsing.
	 */
	browse(key: unknown, delta: -1 | 1, typed: string): string | null;
}

/** Sent messages per buffer, recalled with Up and Down */
export default function useInputHistory(): InputHistory {
	// Oldest first
	const history = useRef(new Map<unknown, string[]>());
	// Position in the history of the active buffer (its length when not
	// browsing it), and the text typed before browsing it
	const historyPos = useRef<{ key: unknown; index: number; typed: string } | null>(null);

	return useMemo(
		() => ({
			add(key, text) {
				const sent = history.current.get(key) ?? [];
				if (sent.at(-1) !== text) {
					sent.push(text);
					sent.splice(0, sent.length - HISTORY_SIZE);
				}
				history.current.set(key, sent);
				historyPos.current = null;
			},
			browse(key, delta, typed) {
				const sent = history.current.get(key) ?? [];
				let pos = historyPos.current;
				if (!pos || pos.key !== key) {
					pos = { key, index: sent.length, typed };
				}
				const index = pos.index + delta;
				if (index < 0 || index > sent.length) {
					return null;
				}
				historyPos.current = { ...pos, index };
				return index === sent.length ? pos.typed : sent[index];
			},
		}),
		[],
	);
}
