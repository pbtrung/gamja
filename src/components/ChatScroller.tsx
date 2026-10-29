import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { JumpToUnread, ScrollToLatest } from "./scroller/JumpButtons";
import {
	prefersReducedMotion,
	restorePosition,
	savePosition,
	scrollToBottom,
	scrollToMessage,
} from "./scroller/position";
import useNewCount from "./scroller/useNewCount";
import useStickToBottom from "./scroller/useStickToBottom";
import useUnreadMarker from "./scroller/useUnreadMarker";

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
	const unreadKey = `${String(scrollKey)}:${unreadLabel}`;
	const unread = useUnreadMarker(ref, unreadMarker, unreadKey);
	// Offers to scroll back to the latest messages when scrolled up
	const [awayFromBottom, setAwayFromBottom] = useState(false);
	const stickToBottom = useRef(true);
	const {
		count: newCount,
		update: updateNewCount,
		reset: resetNewCount,
	} = useNewCount(stickTo, stickToBottom);
	const onScrollTopRef = useRef(onScrollTop);

	const onBottomChangeRef = useRef(onBottomChange);

	useEffect(() => {
		onScrollTopRef.current = onScrollTop;
		onBottomChangeRef.current = onBottomChange;
	});

	useEffect(() => {
		onBottomChangeRef.current?.(!awayFromBottom);
	}, [awayFromBottom]);

	function save(el: HTMLElement) {
		const wasAtBottom = stickToBottom.current;
		stickToBottom.current = savePosition(el, scrollKey, stickTo);
		setAwayFromBottom(!stickToBottom.current);
		if (stickToBottom.current && !wasAtBottom) {
			// Read down to the end
			unread.dismiss();
		}
		updateNewCount(el);
	}

	// Restore the position when the content changes: either the buffer
	// changed or messages were added. Size changes while sticking to the
	// bottom are handled by useStickToBottom.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		if (jumpTo && scrollToMessage(el, jumpTo)) {
			stickToBottom.current = savePosition(el, scrollKey, stickTo);
			setAwayFromBottom(!stickToBottom.current);
			updateNewCount(el);
			onJumped?.();
			return;
		}

		// Put the anchor back where it was, to the pixel: re-renders that
		// don't change the messages above it mustn't move the view
		stickToBottom.current = restorePosition(el, scrollKey);
		setAwayFromBottom(!stickToBottom.current);
		updateNewCount(el);

		if (el.scrollTop === 0) {
			onScrollTopRef.current();
		}
	}, [scrollKey, jumpTo, onJumped, stickTo, children, updateNewCount]);

	// Messages already there when switching buffers aren't new
	useLayoutEffect(() => {
		resetNewCount();
		const el = ref.current;
		if (el) {
			updateNewCount(el);
		}
		// updateNewCount only changes with stickTo
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scrollKey]);

	useStickToBottom(ref, stickToBottom);

	function jumpToUnread() {
		const el = ref.current;
		const marker = unreadMarker ? el?.querySelector(unreadMarker) : null;
		if (!el || !marker) {
			return;
		}
		el.scrollTop += marker.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
		save(el);
		unread.dismiss();
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
			{unread.shown && (
				<JumpToUnread label={unreadLabel} onJump={jumpToUnread} onDismiss={unread.dismiss} />
			)}
			{children}
			{awayFromBottom && <ScrollToLatest newCount={newCount} onClick={scrollToLatest} />}
		</section>
	);
}
