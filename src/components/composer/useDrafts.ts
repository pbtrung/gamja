import { useState } from "react";

/**
 * The composer text, kept per buffer: switching buffers stashes the
 * unsent text of the previous one and restores the new one's.
 */
export default function useDrafts(draftKey: unknown): [string, (text: string) => void] {
	const [text, setText] = useState("");
	// Unsent text of the other buffers
	const [drafts, setDrafts] = useState(() => new Map<unknown, string>());
	const [prevDraftKey, setPrevDraftKey] = useState(draftKey);
	if (draftKey !== prevDraftKey) {
		const next = new Map(drafts);
		if (text) {
			next.set(prevDraftKey, text);
		}
		setText(next.get(draftKey) ?? "");
		next.delete(draftKey);
		setDrafts(next);
		setPrevDraftKey(draftKey);
	}
	return [text, setText];
}
