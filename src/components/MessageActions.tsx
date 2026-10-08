import { useEffect, useRef, useState, type RefObject } from "react";
import { Reply, SmilePlus, Trash2 } from "lucide-react";
import { QUICK_REACTIONS } from "../format";
import IconButton from "./IconButton";

interface ReactionPickerProps {
	onPick: (emoji: string) => void;
	onClose: () => void;
	/** The button toggling the picker, which handles its own clicks */
	toggleRef: RefObject<HTMLButtonElement | null>;
}

function ReactionPicker({ onPick, onClose, toggleRef }: ReactionPickerProps) {
	const ref = useRef<HTMLDivElement>(null);
	// onClose changes on every render of the parent: don't re-run the effects
	const onCloseRef = useRef(onClose);
	useEffect(() => {
		onCloseRef.current = onClose;
	});

	useEffect(() => {
		ref.current?.querySelector("button")?.focus();
	}, []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onCloseRef.current();
			}
		};
		const handlePointer = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!ref.current?.contains(target) && !toggleRef.current?.contains(target)) {
				onCloseRef.current();
			}
		};
		window.addEventListener("keydown", handleKeyDown, true);
		window.addEventListener("pointerdown", handlePointer, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
			window.removeEventListener("pointerdown", handlePointer, true);
		};
	}, [toggleRef]);

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
	const toggleRef = useRef<HTMLButtonElement>(null);
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
				<IconButton
					icon={SmilePlus}
					label="Add reaction"
					hasPopup="menu"
					expanded={picking}
					ref={toggleRef}
					onClick={() => setPicking((p) => !p)}
				/>
			)}
			{canReply && <IconButton icon={Reply} label="Reply" onClick={onReply} />}
			{canRedact && (
				<IconButton
					icon={Trash2}
					label="Delete message"
					className="danger"
					onClick={() => {
						if (window.confirm("Delete this message for everyone?")) {
							onRedact();
						}
					}}
				/>
			)}
			{picking && (
				<ReactionPicker onPick={onReact} onClose={() => setPicking(false)} toggleRef={toggleRef} />
			)}
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
