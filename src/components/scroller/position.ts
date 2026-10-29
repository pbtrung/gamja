import { flash } from "../../lib/flash";

/** A message and its distance from the top of the viewport, in pixels */
interface Anchor {
	key: string;
	offset: number;
}

/** Saved scroll anchors, by scroll key. null means "stick to the bottom". */
const positions = new Map<unknown, Anchor | null>();

function isAtBottom(el: HTMLElement): boolean {
	return Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 10;
}

export function scrollToBottom(el: HTMLElement): void {
	el.scrollTop = el.scrollHeight;
}

export function prefersReducedMotion(): boolean {
	return (
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/** How many anchors come after the one with the given key, 0 if it's gone */
export function countAnchorsAfter(el: HTMLElement, stickTo: string, key: string): number {
	const anchors = [...el.querySelectorAll<HTMLElement>(stickTo)];
	const i = anchors.findLastIndex((anchor) => anchor.dataset.key === key);
	return i < 0 ? 0 : anchors.length - 1 - i;
}

export function lastAnchorKey(el: HTMLElement, stickTo: string): string | null {
	const anchors = el.querySelectorAll<HTMLElement>(stickTo);
	return anchors[anchors.length - 1]?.dataset.key ?? null;
}

function firstVisibleAnchor(el: HTMLElement, stickTo: string): Anchor | null {
	const top = el.getBoundingClientRect().top;
	const anchors = el.querySelectorAll<HTMLElement>(stickTo);
	// Anchors are laid out from top to bottom: find the first one starting
	// in view with a binary search. This runs on every scroll event, and
	// measuring each of the thousands of lines above the view is slow.
	let lo = 0;
	let hi = anchors.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (anchors[mid].getBoundingClientRect().top >= top) {
			hi = mid;
		} else {
			lo = mid + 1;
		}
	}
	for (let i = lo; i < anchors.length; i++) {
		const key = anchors[i].dataset.key;
		if (key) {
			return { key, offset: anchors[i].getBoundingClientRect().top - top };
		}
	}
	return null;
}

/** Save the scroll position of a key, returns whether it's at the bottom. */
export function savePosition(el: HTMLElement, scrollKey: unknown, stickTo: string): boolean {
	const atBottom = isAtBottom(el);
	positions.set(scrollKey, atBottom ? null : firstVisibleAnchor(el, stickTo));
	return atBottom;
}

/**
 * Put the saved anchor of a key back where it was, to the pixel, or scroll
 * to the bottom. Returns whether it sticks to the bottom.
 */
export function restorePosition(el: HTMLElement, scrollKey: unknown): boolean {
	const saved = positions.get(scrollKey) ?? null;
	const anchor = saved ? el.querySelector<HTMLElement>(`[data-key="${CSS.escape(saved.key)}"]`) : null;
	if (saved && anchor) {
		el.scrollTop += anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.offset;
		return false;
	}
	scrollToBottom(el);
	return true;
}

/** Scroll a message into view and flash it, returns whether it was found */
export function scrollToMessage(el: HTMLElement, msgid: string): boolean {
	const target = el.querySelector<HTMLElement>(`[data-msgid="${CSS.escape(msgid)}"]`);
	if (!target) {
		return false;
	}
	el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight / 3;
	flash(target);
	return true;
}
