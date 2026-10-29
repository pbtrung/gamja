import { ArrowDown, ArrowUp, X } from "lucide-react";

interface JumpToUnreadProps {
	label: string;
	onJump: () => void;
	onDismiss: () => void;
}

/** Offers to jump up to the unread marker */
export function JumpToUnread({ label, onJump, onDismiss }: JumpToUnreadProps) {
	return (
		<div className="jump-unread">
			<div className="jump-pill" role="group" aria-label="New messages">
				<button type="button" className="btn btn-sm" onClick={onJump}>
					<ArrowUp aria-hidden="true" /> {label}
				</button>
				<button
					type="button"
					className="btn btn-sm jump-dismiss"
					title="Dismiss"
					aria-label="Dismiss"
					onClick={onDismiss}
				>
					<X aria-hidden="true" />
				</button>
			</div>
		</div>
	);
}

interface ScrollToLatestProps {
	/** Messages received since scrolling up */
	newCount: number;
	onClick: () => void;
}

/** Offers to scroll back to the latest messages when scrolled up */
export function ScrollToLatest({ newCount, onClick }: ScrollToLatestProps) {
	return (
		<div className="scroll-latest">
			<button
				type="button"
				className="btn"
				title="Scroll to latest messages"
				aria-label={
					newCount > 0 ? `Scroll to latest messages, ${newCount} new` : "Scroll to latest messages"
				}
				onClick={onClick}
			>
				{newCount > 0 && <span className="new-count">{newCount} new</span>}
				<ArrowDown aria-hidden="true" />
			</button>
		</div>
	);
}
