import { useEffect, useRef } from "react";

/** How far a finger must move sideways, in pixels, to be a swipe */
const MIN_DISTANCE = 60;

export type SwipeDirection = "left" | "right";

/**
 * Call onSwipe on horizontal swipes anywhere on the page, while enabled.
 * Swipes mostly vertical are scrolling, and swipes in text fields or
 * dialogs belong to them.
 */
export default function useSwipe(enabled: boolean, onSwipe: (direction: SwipeDirection) => void): void {
	const onSwipeRef = useRef(onSwipe);
	useEffect(() => {
		onSwipeRef.current = onSwipe;
	});

	useEffect(() => {
		if (!enabled) {
			return;
		}
		let start: { x: number; y: number } | null = null;
		const handleTouchStart = (event: TouchEvent) => {
			const touch = event.touches[0];
			const target = event.target instanceof Element ? event.target : null;
			if (
				!touch ||
				event.touches.length > 1 ||
				target?.closest("input, textarea, pre, [aria-modal='true'], [role='menu']")
			) {
				start = null;
				return;
			}
			start = { x: touch.clientX, y: touch.clientY };
		};
		const handleTouchEnd = (event: TouchEvent) => {
			const touch = event.changedTouches[0];
			const from = start;
			start = null;
			if (!touch || !from) {
				return;
			}
			const dx = touch.clientX - from.x;
			const dy = touch.clientY - from.y;
			if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < 2 * Math.abs(dy)) {
				return;
			}
			onSwipeRef.current(dx > 0 ? "right" : "left");
		};
		window.addEventListener("touchstart", handleTouchStart, { passive: true });
		window.addEventListener("touchend", handleTouchEnd, { passive: true });
		return () => {
			window.removeEventListener("touchstart", handleTouchStart);
			window.removeEventListener("touchend", handleTouchEnd);
		};
	}, [enabled]);
}
