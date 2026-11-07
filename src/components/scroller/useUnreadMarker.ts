import { useEffect, useState, type RefObject } from "react";

export interface UnreadMarkerState {
	/** Whether to offer to jump to the unread marker */
	shown: boolean;
	/** Hide the jump button, until another marker comes */
	dismiss: () => void;
}

/**
 * Keep the jump button available for the lifetime of the unread marker.
 * unreadKey identifies the marker: the jump button is dismissed per key.
 */
export default function useUnreadMarker(
	ref: RefObject<HTMLElement | null>,
	unreadMarker: string | undefined,
	unreadKey: string,
): UnreadMarkerState {
	const [hasMarker, setHasMarker] = useState(false);
	// The jump button was closed: by scroll key and marker, so that
	// another marker shows it again
	const [unreadDismissed, setUnreadDismissed] = useState<string | null>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el || !unreadMarker) {
			return;
		}
		const update = () => {
			setHasMarker(el.querySelector(unreadMarker) !== null);
		};
		update();
		const mutationObserver = new MutationObserver(update);
		mutationObserver.observe(el, { childList: true, subtree: true });
		return () => {
			mutationObserver.disconnect();
		};
	}, [ref, unreadMarker]);

	return {
		shown: hasMarker && unreadDismissed !== unreadKey,
		dismiss: () => setUnreadDismissed(unreadKey),
	};
}
