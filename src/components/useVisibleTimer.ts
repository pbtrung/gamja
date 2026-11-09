import { useEffect, useRef, useState } from "react";

/** Pause while hidden, or require a continuous visible interval when requested. */
export default function useVisibleTimer(
	key: string,
	visible: boolean,
	duration: number,
	continuous = false,
): boolean {
	const remaining = useRef({ key, ms: duration });
	const [expiredKey, setExpiredKey] = useState<string | null>(null);
	useEffect(() => {
		if (remaining.current.key !== key) {
			remaining.current = { key, ms: duration };
			setExpiredKey(null);
		}
		if (!visible) {
			return;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		let started: number | null = null;
		const pause = () => {
			clearTimeout(timer);
			if (started !== null) {
				remaining.current.ms = Math.max(0, remaining.current.ms - (Date.now() - started));
				started = null;
			}
		};
		const resume = () => {
			pause();
			if (document.visibilityState !== "hidden") {
				if (continuous) {
					remaining.current.ms = duration;
				}
				started = Date.now();
				timer = setTimeout(() => setExpiredKey(key), remaining.current.ms);
			}
		};
		resume();
		document.addEventListener("visibilitychange", resume);
		return () => {
			pause();
			document.removeEventListener("visibilitychange", resume);
		};
	}, [key, visible, duration, continuous]);
	return expiredKey === key;
}
