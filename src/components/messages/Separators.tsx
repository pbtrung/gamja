import type { HistoryGap } from "../../state";

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

export function UnreadSeparator() {
	return (
		<div className="separator unread-separator" role="separator">
			New messages
		</div>
	);
}

/** Where missed messages weren't fetched, with a button to fetch them. */
export function GapMarker({ gap, onLoad }: { gap: HistoryGap; onLoad?: () => void }) {
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
				: "Some missed messages aren't shown."}
			<button type="button" className="btn btn-sm" onClick={onLoad}>
				{gap.status === "error" ? "Retry" : "Load missed messages"}
			</button>
		</div>
	);
}
