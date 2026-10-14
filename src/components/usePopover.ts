import { useEffect, useRef, type RefObject } from "react";

/**
 * Close a popup rendered in the body while it's open: on Escape, and on
 * pointer events outside of it and of its toggle, which handles its own
 * clicks. Escape doesn't reach other handlers, e.g. a dialog's.
 */
export default function usePopover(
	open: boolean,
	popupRef: RefObject<HTMLElement | null>,
	toggleRef: RefObject<HTMLElement | null>,
	onClose: (reason: "escape" | "outside") => void,
): void {
	// onClose may change on every render: don't re-run the effect
	const onCloseRef = useRef(onClose);
	useEffect(() => {
		onCloseRef.current = onClose;
	});

	useEffect(() => {
		if (!open) {
			return;
		}
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onCloseRef.current("escape");
			}
		};
		const handlePointer = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!popupRef.current?.contains(target) && !toggleRef.current?.contains(target)) {
				onCloseRef.current("outside");
			}
		};
		window.addEventListener("keydown", handleKeyDown, true);
		window.addEventListener("pointerdown", handlePointer, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
			window.removeEventListener("pointerdown", handlePointer, true);
		};
	}, [open, popupRef, toggleRef]);
}
