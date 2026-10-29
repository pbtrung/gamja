import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Item } from "../store";

const PANE_WIDTH_MIN = 160;
const PANE_WIDTH_MAX = 480;
/** How far the arrow keys move the edge, in pixels */
const KEY_STEP = 16;

function clampPaneWidth(width: number): number {
	return Math.round(Math.min(Math.max(width, PANE_WIDTH_MIN), PANE_WIDTH_MAX));
}

interface PaneResizerProps {
	/** Which side of the window the pane is on: its other edge moves */
	side: "left" | "right";
	label: string;
	/** ID of the pane, for aria-controls */
	controls: string;
	/** CSS variable set to the width, on the root element */
	cssVariable: string;
	/** Where the width is remembered */
	item: Item<number>;
}

/**
 * A handle on the inner edge of a side pane, dragged to resize it. The arrow
 * keys resize it too, and a double click goes back to the default width.
 */
export default function PaneResizer({ side, label, controls, cssVariable, item }: PaneResizerProps) {
	const [width, setWidth] = useState<number | null>(() => {
		const stored = item.load();
		return typeof stored === "number" && Number.isFinite(stored) ? clampPaneWidth(stored) : null;
	});
	const drag = useRef<{ startX: number; startWidth: number } | null>(null);
	const ref = useRef<HTMLDivElement>(null);
	// The default width, from the CSS, when none was chosen
	const [defaultWidth, setDefaultWidth] = useState<number | null>(null);

	useLayoutEffect(() => {
		const style = document.documentElement.style;
		if (width === null) {
			style.removeProperty(cssVariable);
			const handle = ref.current;
			if (handle) {
				setDefaultWidth(paneWidth(handle));
			}
		} else {
			style.setProperty(cssVariable, `${width}px`);
		}
	}, [cssVariable, width]);

	/** The width of the pane, without its border */
	function paneWidth(handle: HTMLElement): number {
		return handle.parentElement?.clientWidth ?? PANE_WIDTH_MIN;
	}

	function resize(next: number | null) {
		const clamped = next === null ? null : clampPaneWidth(next);
		setWidth(clamped);
		item.put(clamped);
	}

	function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { startX: event.clientX, startWidth: paneWidth(event.currentTarget) };
		document.documentElement.classList.add("resizing-pane");
	}

	function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
		const start = drag.current;
		if (!start) {
			return;
		}
		const dx = event.clientX - start.startX;
		setWidth(clampPaneWidth(start.startWidth + (side === "left" ? dx : -dx)));
	}

	function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
		if (!drag.current) {
			return;
		}
		drag.current = null;
		document.documentElement.classList.remove("resizing-pane");
		resize(paneWidth(event.currentTarget));
	}

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		// Arrows move the edge, wherever the pane is
		const delta = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[event.key];
		if (delta === undefined) {
			return;
		}
		event.preventDefault();
		resize(paneWidth(event.currentTarget) + (side === "left" ? delta : -delta));
	}

	return (
		<div
			ref={ref}
			className={`pane-resizer ${side}`}
			role="separator"
			aria-orientation="vertical"
			aria-label={label}
			aria-controls={controls}
			aria-valuemin={PANE_WIDTH_MIN}
			aria-valuemax={PANE_WIDTH_MAX}
			aria-valuenow={width ?? defaultWidth ?? PANE_WIDTH_MIN}
			title={`${label} (double-click to reset)`}
			tabIndex={0}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
			onDoubleClick={() => resize(null)}
			onKeyDown={handleKeyDown}
		/>
	);
}
