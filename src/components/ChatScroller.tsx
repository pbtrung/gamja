import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
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
}

function isAtBottom(el: HTMLElement): boolean {
	return Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 10;
}

function scrollToBottom(el: HTMLElement): void {
	el.scrollTop = el.scrollHeight;
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
}: ChatScrollerProps) {
	const ref = useRef<HTMLElement>(null);
	const stickToBottom = useRef(true);
	const onScrollTopRef = useRef(onScrollTop);

	useEffect(() => {
		onScrollTopRef.current = onScrollTop;
	});

	function firstVisibleAnchor(el: HTMLElement): Anchor | null {
		const top = el.getBoundingClientRect().top;
		for (const child of el.querySelectorAll<HTMLElement>(stickTo)) {
			const childTop = child.getBoundingClientRect().top;
			if (childTop >= top && child.dataset.key) {
				return { key: child.dataset.key, offset: childTop - top };
			}
		}
		return null;
	}

	function save(el: HTMLElement) {
		stickToBottom.current = isAtBottom(el);
		positions.set(scrollKey, stickToBottom.current ? null : firstVisibleAnchor(el));
	}

	// Restore the position after every render: either the buffer changed or
	// messages were added
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
				save(el);
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

		if (el.scrollTop === 0) {
			onScrollTopRef.current();
		}
	});

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
			{children}
		</section>
	);
}
