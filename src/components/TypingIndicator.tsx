import { useEffect, useState } from "react";
import { getTypingNicks, type Buffer } from "../state";
import { describeTyping } from "../format";

/** "bob is typing…" line above the composer. */
export default function TypingIndicator({ buffer }: { buffer: Buffer | null }) {
	const [now, setNow] = useState(() => Date.now());
	const active = buffer ? buffer.typing.size > 0 : false;

	// Re-render periodically to expire stale notifications. Notifications
	// received after the last tick count as fresh.
	useEffect(() => {
		if (!active) {
			return;
		}
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [active]);

	const text = buffer ? describeTyping(getTypingNicks(buffer, now)) : null;
	return (
		<div className="typing-indicator" aria-live="polite">
			{text && (
				<>
					<span className="typing-dots" aria-hidden="true">
						<span />
						<span />
						<span />
					</span>
					{text}
				</>
			)}
		</div>
	);
}
