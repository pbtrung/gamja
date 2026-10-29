import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { flash } from "../lib/flash";

/** A message and its distance from the top of the viewport, in pixels */
interface Anchor {
	key: string;
	offset: number;
}

/** Saved scroll anchors, by scroll key. null means "stick to the bottom". */
const positions = new Map<unknown, Anchor | null>();

interface ChatScrollerProps {
	scrollKey: unknown;
	/** Selector for the elements used as scroll anchors */
	stickTo: string;
	onScrollTop: () => void;
	children: ReactNode;
	id?: string;
	label?: string;
	/** data-msgid of a message to scroll to */
	jumpTo?: string | null;
	onJumped?: () => void;
	/** Selector for the unread marker: offers to jump to it when scrolled past */
	unreadMarker?: string;
	/** Text of the button jumping to the unread marker */
	unreadLabel?: string;
	/** Called when scrolling to the bottom, or away from it */
	onBottomChange?: (atBottom: boolean) => void;
}

function isAtBottom(el: HTMLElement): boolean {
	return Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 10;
}

function scrollToBottom(el: HTMLElement): void {
	el.scrollTop = el.scrollHeight;
}

function prefersReducedMotion(): boolean {
	return (
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/** How many anchors come after the one with the given key, 0 if it's gone */
function countAnchorsAfter(el: HTMLElement, stickTo: string, key: string): number {
	const anchors = [...el.querySelectorAll<HTMLElement>(stickTo)];
	const i = anchors.findLastIndex((anchor) => anchor.dataset.key === key);
	return i < 0 ? 0 : anchors.length - 1 - i;
}

function lastAnchorKey(el: HTMLElement, stickTo: string): string | null {
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
function savePosition(el: HTMLElement, scrollKey: unknown, stickTo: string): boolean {
	const atBottom = isAtBottom(el);
	positions.set(scrollKey, atBottom ? null : firstVisibleAnchor(el, stickTo));
	return atBottom;
}

/**
 * Scrollable chat log container. Sticks to the bottom when new messages
 * arrive, keeps the first visible message in place when older messages are
 * prepended, and remembers the position of each buffer.
 */
export default function ChatScroller({
	scrollKey,
	stickTo,
	onScrollTop,
	children,
	id,
	label,
	jumpTo,
	onJumped,
	unreadMarker,
	unreadLabel = "Jump to new messages",
	onBottomChange,
}: ChatScrollerProps) {
	const ref = useRef<HTMLElement>(null);
	const [unreadAbove, setUnreadAbove] = useState(false);
	// The jump button was closed, or the user scrolled down to the end: by
	// scroll key and marker, so that another marker shows it again
	const [unreadDismissed, setUnreadDismissed] = useState<string | null>(null);
	const unreadKey = `${String(scrollKey)}:${unreadLabel}`;
	// The last message when the user left the bottom: the ones after it are
	// new, counted on the button scrolling back down
	const lastSeenKey = useRef<string | null>(null);
	const [newCount, setNewCount] = useState(0);
	// Offers to scroll back to the latest messages when scrolled up
	const [awayFromBottom, setAwayFromBottom] = useState(false);
	const stickToBottom = useRef(true);
	const onScrollTopRef = useRef(onScrollTop);

	const onBottomChangeRef = useRef(onBottomChange);

	useEffect(() => {
		onScrollTopRef.current = onScrollTop;
		onBottomChangeRef.current = onBottomChange;
	});

	useEffect(() => {
		onBottomChangeRef.current?.(!awayFromBottom);
	}, [awayFromBottom]);

	function updateNewCount(el: HTMLElement) {
		if (stickToBottom.current) {
			lastSeenKey.current = null;
		} else if (lastSeenKey.current === null) {
			lastSeenKey.current = lastAnchorKey(el, stickTo);
		}
		setNewCount(lastSeenKey.current === null ? 0 : countAnchorsAfter(el, stickTo, lastSeenKey.current));
	}

	function save(el: HTMLElement) {
		const wasAtBottom = stickToBottom.current;
		stickToBottom.current = savePosition(el, scrollKey, stickTo);
		setAwayFromBottom(!stickToBottom.current);
		if (stickToBottom.current && !wasAtBottom) {
			// Read down to the end
			setUnreadDismissed(unreadKey);
		}
		updateNewCount(el);
	}

	// Restore the position when the content changes: either the buffer
	// changed or messages were added. Size changes while sticking to the
	// bottom are handled by the resize observer below.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		if (jumpTo) {
			const target = el.querySelector<HTMLElement>(`[data-msgid="${CSS.escape(jumpTo)}"]`);
			if (target) {
				el.scrollTop +=
					target.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight / 3;
				flash(target);
				stickToBottom.current = savePosition(el, scrollKey, stickTo);
				setAwayFromBottom(!stickToBottom.current);
				updateNewCount(el);
				onJumped?.();
				return;
			}
		}

		// Put the anchor back where it was, to the pixel: re-renders that
		// don't change the messages above it mustn't move the view
		const saved = positions.get(scrollKey) ?? null;
		const anchor = saved ? el.querySelector<HTMLElement>(`[data-key="${CSS.escape(saved.key)}"]`) : null;
		if (saved && anchor) {
			el.scrollTop +=
				anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.offset;
			stickToBottom.current = false;
		} else {
			scrollToBottom(el);
			stickToBottom.current = true;
		}
		setAwayFromBottom(!stickToBottom.current);
		updateNewCount(el);

		if (el.scrollTop === 0) {
			onScrollTopRef.current();
		}
		// updateNewCount only reads refs and the stickTo dependency
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scrollKey, jumpTo, onJumped, stickTo, children]);

	// Messages already there when switching buffers aren't new
	useLayoutEffect(() => {
		lastSeenKey.current = null;
		const el = ref.current;
		if (el) {
			updateNewCount(el);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scrollKey]);

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
	}, []);

	// Watch whether the unread marker is above the view, it can come and go
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
	}, [unreadMarker]);

	function jumpToUnread() {
		const el = ref.current;
		const marker = unreadMarker ? el?.querySelector(unreadMarker) : null;
		if (!el || !marker) {
			return;
		}
		el.scrollTop += marker.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
		save(el);
		setUnreadDismissed(unreadKey);
	}

	function scrollToLatest() {
		const el = ref.current;
		if (!el) {
			return;
		}
		if (typeof el.scrollTo === "function" && !prefersReducedMotion()) {
			// The scroll events update the saved position as it goes
			el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
		} else {
			scrollToBottom(el);
			save(el);
		}
	}

	return (
		<section
			id={id}
			ref={ref}
			tabIndex={-1}
			role="log"
			aria-label={label}
			onScroll={(event) => {
				const el = event.currentTarget;
				save(el);
				if (el.scrollTop === 0) {
					onScrollTopRef.current();
				}
			}}
		>
			{unreadAbove && unreadDismissed !== unreadKey && (
				<div className="jump-unread">
					<div className="jump-pill" role="group" aria-label="New messages">
						<button type="button" className="btn btn-sm" onClick={jumpToUnread}>
							<ArrowUp aria-hidden="true" /> {unreadLabel}
						</button>
						<button
							type="button"
							className="btn btn-sm jump-dismiss"
							title="Dismiss"
							aria-label="Dismiss"
							onClick={() => setUnreadDismissed(unreadKey)}
						>
							<X aria-hidden="true" />
						</button>
					</div>
				</div>
			)}
			{children}
			{awayFromBottom && (
				<div className="scroll-latest">
					<button
						type="button"
						className="btn"
						title="Scroll to latest messages"
						aria-label={
							newCount > 0
								? `Scroll to latest messages, ${newCount} new`
								: "Scroll to latest messages"
						}
						onClick={scrollToLatest}
					>
						{newCount > 0 && <span className="new-count">{newCount} new</span>}
						<ArrowDown aria-hidden="true" />
					</button>
				</div>
			)}
		</section>
	);
}
