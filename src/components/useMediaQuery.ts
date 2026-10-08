import { useSyncExternalStore } from "react";

function supported(): boolean {
	return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/** Whether a CSS media query matches, updated when it changes. */
export default function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			if (!supported()) {
				return () => {};
			}
			const mql = window.matchMedia(query);
			mql.addEventListener("change", onChange);
			return () => mql.removeEventListener("change", onChange);
		},
		() => supported() && window.matchMedia(query).matches,
		() => false,
	);
}
