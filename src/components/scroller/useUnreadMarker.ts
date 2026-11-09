import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import useVisibleTimer from "../useVisibleTimer";

export interface UnreadMarkerState {
	/** Whether to offer to jump to the unread marker */
	shown: boolean;
	/** Hide the jump button for this opening of the buffer */
	dismiss: () => void;
}

/**
 * Offer the unread jump button for eight seconds on opening a buffer.
 * unreadKey identifies that opening; later messages don't reopen the pill.
 */
export default function useUnreadMarker(
	ref: RefObject<HTMLElement | null>,
	unreadMarker: string | undefined,
	unreadKey: string,
	pendingHistory = false,
): UnreadMarkerState {
	const [hasMarker, setHasMarker] = useState(false);
	// Dismissal is independent of the changing loaded-message count.
	const [unreadDismissed, setUnreadDismissed] = useState<string | null>(null);
	const expired = useVisibleTimer(unreadKey, true, 8000);
	const isPending = useEffectEvent(() => pendingHistory);

	useEffect(() => {
		const el = ref.current;
		if (!el || !unreadMarker) {
			return;
		}
		// Allow the initial history load to supply the marker, but never
		// introduce a pill for messages arriving in an already open buffer.
		const eligible = el.querySelector(unreadMarker) !== null || isPending();
		const update = () => {
			setHasMarker(eligible && el.querySelector(unreadMarker) !== null);
		};
		update();
		const mutationObserver = new MutationObserver(update);
		mutationObserver.observe(el, { childList: true, subtree: true });
		return () => {
			mutationObserver.disconnect();
		};
	}, [ref, unreadMarker, unreadKey]);

	return {
		shown: hasMarker && unreadDismissed !== unreadKey && !expired,
		dismiss: () => setUnreadDismissed(unreadKey),
	};
}
