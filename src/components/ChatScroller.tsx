import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

/** Saved scroll anchors, by scroll key. null means "stick to the bottom". */
const positions = new Map<unknown, string | null>();

interface ChatScrollerProps {
	scrollKey: unknown;
	/** Selector for the elements used as scroll anchors */
	stickTo: string;
	onScrollTop: () => void;
	children: ReactNode;
	className?: string;
	id?: string;
	label?: string;
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
	className,
	id,
	label,
}: ChatScrollerProps) {
	const ref = useRef<HTMLElement>(null);
	const stickToBottom = useRef(true);
	const onScrollTopRef = useRef(onScrollTop);

	useEffect(() => {
		onScrollTopRef.current = onScrollTop;
	});

	function firstVisibleKey(el: HTMLElement): string | null {
		const top = el.getBoundingClientRect().top;
		for (const child of el.querySelectorAll<HTMLElement>(stickTo)) {
			if (child.getBoundingClientRect().top >= top) {
				return child.dataset.key ?? null;
			}
		}
		return null;
	}

	function save(el: HTMLElement) {
		stickToBottom.current = isAtBottom(el);
		positions.set(scrollKey, stickToBottom.current ? null : firstVisibleKey(el));
	}

	// Restore the position after every render: either the buffer changed or
	// messages were added
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const anchorKey = positions.get(scrollKey) ?? null;
		const anchor = anchorKey
			? el.querySelector<HTMLElement>(`[data-key="${CSS.escape(anchorKey)}"]`)
			: null;
		if (anchor) {
			el.scrollTop += anchor.getBoundingClientRect().top - el.getBoundingClientRect().top;
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
		observer.observe(el);
		if (el.firstElementChild) {
			observer.observe(el.firstElementChild);
		}
		return () => observer.disconnect();
	}, []);

	return (
		<section
			id={id}
			className={className}
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
