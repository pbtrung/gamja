import { useCallback, useSyncExternalStore } from "react";

function supported(): boolean {
	return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/** Whether a CSS media query matches, updated when it changes. */
export default function useMediaQuery(query: string): boolean {
	// Stable, otherwise every render would subscribe again
	const subscribe = useCallback(
		(onChange: () => void) => {
			if (!supported()) {
				return () => {};
			}
			const mql = window.matchMedia(query);
			mql.addEventListener("change", onChange);
			return () => mql.removeEventListener("change", onChange);
		},
		[query],
	);
	return useSyncExternalStore(
		subscribe,
		() => supported() && window.matchMedia(query).matches,
		() => false,
	);
}
