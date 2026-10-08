import { useEffect, useRef, useState } from "react";
import { Reply, SmilePlus, Trash2 } from "lucide-react";
import { QUICK_REACTIONS } from "../format";

interface ReactionPickerProps {
	onPick: (emoji: string) => void;
	onClose: () => void;
}

function ReactionPicker({ onPick, onClose }: ReactionPickerProps) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		ref.current?.querySelector("button")?.focus();
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
			}
		};
		const handlePointer = (event: PointerEvent) => {
			if (!ref.current?.contains(event.target as Node)) {
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown, true);
		window.addEventListener("pointerdown", handlePointer, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
			window.removeEventListener("pointerdown", handlePointer, true);
		};
	}, [onClose]);

	return (
		<div className="reaction-picker" role="menu" aria-label="Pick a reaction" ref={ref}>
			{QUICK_REACTIONS.map((emoji) => (
				<button
					key={emoji}
					type="button"
					role="menuitem"
					className="reaction-choice"
					aria-label={`React with ${emoji}`}
					onClick={() => {
						onPick(emoji);
						onClose();
					}}
				>
					{emoji}
				</button>
			))}
		</div>
	);
}

interface MessageActionsProps {
	canReact: boolean;
	canReply: boolean;
	canRedact: boolean;
	onReact: (emoji: string) => void;
	onReply: () => void;
	onRedact: () => void;
}

/** Toolbar shown when hovering or focusing a message. */
export default function MessageActions({
	canReact,
	canReply,
	canRedact,
	onReact,
	onReply,
	onRedact,
}: MessageActionsProps) {
	const [picking, setPicking] = useState(false);
	if (!canReact && !canReply && !canRedact) {
		return null;
	}
	return (
		<div
			className={"message-actions" + (picking ? " open" : "")}
			role="toolbar"
			aria-label="Message actions"
		>
			{canReact && (
				<button
					type="button"
					className="icon-btn"
					title="Add reaction"
					aria-label="Add reaction"
					aria-haspopup="menu"
					aria-expanded={picking}
					onClick={() => setPicking((p) => !p)}
				>
					<SmilePlus aria-hidden="true" />
				</button>
			)}
			{canReply && (
				<button type="button" className="icon-btn" title="Reply" aria-label="Reply" onClick={onReply}>
					<Reply aria-hidden="true" />
				</button>
			)}
			{canRedact && (
				<button
					type="button"
					className="icon-btn danger"
					title="Delete message"
					aria-label="Delete message"
					onClick={() => {
						if (window.confirm("Delete this message for everyone?")) {
							onRedact();
						}
					}}
				>
					<Trash2 aria-hidden="true" />
				</button>
			)}
			{picking && <ReactionPicker onPick={onReact} onClose={() => setPicking(false)} />}
		</div>
	);
}

interface ReactionsProps {
	reactions: Map<string, string[]>;
	isMine: (nick: string) => boolean;
	canReact: boolean;
	onToggle: (emoji: string) => void;
}

export function Reactions({ reactions, isMine, canReact, onToggle }: ReactionsProps) {
	return (
		<div className="reactions" role="group" aria-label="Reactions">
			{[...reactions].map(([emoji, nicks]) => {
				const mine = nicks.some(isMine);
				const label = `${emoji} ${nicks.length}: ${nicks.join(", ")}`;
				return (
					<button
						key={emoji}
						type="button"
						className={"reaction" + (mine ? " mine" : "")}
						title={nicks.join(", ")}
						aria-label={label}
						aria-pressed={mine}
						disabled={!canReact}
						onClick={() => onToggle(emoji)}
					>
						<span className="reaction-emoji">{emoji}</span>
						<span className="reaction-count">{nicks.length}</span>
					</button>
				);
			})}
		</div>
	);
}
