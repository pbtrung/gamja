import { useEffect, type RefObject } from "react";
import { scrollToBottom } from "./position";

/** Keep sticking to the bottom when the container or its content is resized */
export default function useStickToBottom(
	ref: RefObject<HTMLElement | null>,
	stickToBottom: RefObject<boolean>,
): void {
	useEffect(() => {
		const el = ref.current;
		if (!el || typeof ResizeObserver === "undefined") {
			return;
		}
		const observer = new ResizeObserver(() => {
			if (stickToBottom.current) {
				scrollToBottom(el);
			}
		});
		// Children can be replaced (e.g. an error fallback): watch new ones too
		const observeChildren = () => {
			for (const child of el.children) {
				observer.observe(child);
			}
		};
		observer.observe(el);
		observeChildren();
		const mutationObserver = new MutationObserver(observeChildren);
		mutationObserver.observe(el, { childList: true });
		return () => {
			observer.disconnect();
			mutationObserver.disconnect();
		};
	}, [ref, stickToBottom]);
}
