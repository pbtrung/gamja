import { useEffect, useState, type RefObject } from "react";

export interface UnreadMarkerState {
	/** Whether to offer to jump to the unread marker */
	shown: boolean;
	/** Hide the jump button, until another marker comes */
	dismiss: () => void;
}

/**
 * Watch whether the unread marker is above the view, it can come and go.
 * unreadKey identifies the marker: the jump button is dismissed per key.
 */
export default function useUnreadMarker(
	ref: RefObject<HTMLElement | null>,
	unreadMarker: string | undefined,
	unreadKey: string,
): UnreadMarkerState {
	const [unreadAbove, setUnreadAbove] = useState(false);
	// The jump button was closed, or the user scrolled down to the end: by
	// scroll key and marker, so that another marker shows it again
	const [unreadDismissed, setUnreadDismissed] = useState<string | null>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el || !unreadMarker || typeof IntersectionObserver === "undefined") {
			return;
		}
		let marker: Element | null = null;
		const observer = new IntersectionObserver(([entry]) => {
			const rootTop = entry.rootBounds?.top ?? el.getBoundingClientRect().top;
			setUnreadAbove(!entry.isIntersecting && entry.boundingClientRect.bottom <= rootTop);
		});
		const update = () => {
			const next = el.querySelector(unreadMarker);
			if (next === marker) {
				return;
			}
			if (marker) {
				observer.unobserve(marker);
			}
			marker = next;
			if (marker) {
				observer.observe(marker);
			} else {
				setUnreadAbove(false);
			}
		};
		update();
		const mutationObserver = new MutationObserver(update);
		mutationObserver.observe(el, { childList: true, subtree: true });
		return () => {
			observer.disconnect();
			mutationObserver.disconnect();
		};
	}, [ref, unreadMarker]);

	return {
		shown: unreadAbove && unreadDismissed !== unreadKey,
		dismiss: () => setUnreadDismissed(unreadKey),
	};
}
