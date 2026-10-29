import { useCallback, useRef, useState, type RefObject } from "react";
import { countAnchorsAfter, lastAnchorKey } from "./position";

export interface NewCount {
	/** How many messages came since the user left the bottom */
	count: number;
	/** Count again, after scrolling or new messages */
	update: (el: HTMLElement) => void;
	/** Forget the last seen message, e.g. when switching buffers */
	reset: () => void;
}

/** Count the messages received since the user scrolled up */
export default function useNewCount(stickTo: string, stickToBottom: RefObject<boolean>): NewCount {
	// The last message when the user left the bottom: the ones after it are
	// new, counted on the button scrolling back down
	const lastSeenKey = useRef<string | null>(null);
	const [count, setCount] = useState(0);

	const update = useCallback(
		(el: HTMLElement) => {
			if (stickToBottom.current) {
				lastSeenKey.current = null;
			} else if (lastSeenKey.current === null) {
				lastSeenKey.current = lastAnchorKey(el, stickTo);
			}
			setCount(lastSeenKey.current === null ? 0 : countAnchorsAfter(el, stickTo, lastSeenKey.current));
		},
		[stickTo, stickToBottom],
	);
	const reset = useCallback(() => {
		lastSeenKey.current = null;
	}, []);

	return { count, update, reset };
}
