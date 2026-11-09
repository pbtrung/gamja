import type { HistoryGap } from "../../state";
import { useEffect, useRef, useState } from "react";
import useVisibleTimer from "../useVisibleTimer";

export function DateSeparator({ date }: { date: Date }) {
	const text = date.toLocaleDateString([], {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});
	return (
		<div className="separator date-separator" role="separator">
			{text}
		</div>
	);
}

export function UnreadSeparator({ refreshKey, ...props }: UnreadSeparatorProps) {
	// A new history page gets its own reading time, including when the
	// previous progress text already expired.
	return <TimedUnreadSeparator key={refreshKey ?? props.label} {...props} />;
}

interface UnreadSeparatorProps {
	label: string;
	compactLabel?: string;
	since?: string;
	dateTime?: string;
	refreshKey?: string;
}

function TimedUnreadSeparator({ label, compactLabel, since, dateTime }: UnreadSeparatorProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	const expired = useVisibleTimer("unread-divider", visible, 8000, true);
	useEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const root = el.closest("[role=log]");
		if (typeof IntersectionObserver !== "undefined") {
			const observer = new IntersectionObserver(
				([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio >= 1),
				{ root, threshold: 1 },
			);
			observer.observe(el);
			return () => observer.disconnect();
		}
		const update = () => {
			const bounds = el.getBoundingClientRect();
			const viewport = root?.getBoundingClientRect();
			setVisible(
				bounds.height > 0 &&
					bounds.top >= (viewport?.top ?? 0) &&
					bounds.bottom <= (viewport?.bottom ?? window.innerHeight),
			);
		};
		update();
		root?.addEventListener("scroll", update);
		window.addEventListener("resize", update);
		return () => {
			root?.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
		};
	}, []);
	if (expired) {
		return null;
	}
	return (
		<div
			ref={ref}
			className="separator unread-separator"
			role="separator"
			aria-label={label + (since ? ` · since ${since}` : "")}
		>
			<span className={`unread-summary${compactLabel ? " has-compact" : ""}`} aria-hidden="true">
				<span className="unread-detail">{label}</span>
				{compactLabel && <span className="unread-compact">{compactLabel}</span>}
				{since && (
					<time className="unread-since" dateTime={dateTime}>
						since {since}
					</time>
				)}
			</span>
		</div>
	);
}

/** Where missed messages weren't fetched, with a button to fetch them. */
export function GapMarker({
	gap,
	onLoad,
	limited = false,
}: {
	gap: HistoryGap;
	onLoad?: () => void;
	limited?: boolean;
}) {
	if (gap.status === "loading") {
		return (
			<div className="history-status history-gap" role="status">
				<span className="spinner" aria-hidden="true" /> Loading missed messages…
			</div>
		);
	}
	return (
		<div className="history-status history-gap" role={gap.status === "error" ? "alert" : undefined}>
			{gap.status === "error"
				? "Failed to load missed messages."
				: limited
					? "Buffer limit reached. Older messages may be available."
					: "Some missed messages aren't shown."}
			{!limited && (
				<button type="button" className="btn btn-sm" onClick={onLoad}>
					{gap.status === "error" ? "Retry" : "Load missed messages"}
				</button>
			)}
		</div>
	);
}
