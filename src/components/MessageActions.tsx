import {
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent,
	type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Reply, SmilePlus, Trash2 } from "lucide-react";
import { EMOJIS, QUICK_REACTIONS } from "../format";
import * as store from "../store";
import IconButton from "./IconButton";
import usePopover from "./usePopover";

const QUICK_COUNT = QUICK_REACTIONS.length;

/** Recently picked reactions first, then the default ones. */
function quickReactions(): string[] {
	const recent = store.recentReactions.load() ?? [];
	return [...new Set([...recent, ...QUICK_REACTIONS])].slice(0, QUICK_COUNT);
}

function rememberReaction(emoji: string): void {
	const recent = store.recentReactions.load() ?? [];
	store.recentReactions.put([emoji, ...recent.filter((e) => e !== emoji)].slice(0, 2 * QUICK_COUNT));
}

/** The emoji matching a search, by their words or the emoji itself. */
function searchEmoji(query: string): string[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return EMOJIS.filter(([emoji, keywords]) =>
		words.every((w) => emoji === w || keywords.split(" ").some((k) => k.startsWith(w))),
	).map(([emoji]) => emoji);
}

/** Columns of the reaction grids, as in the styles */
const COLUMNS = 8;

/**
 * Move the focus in a grid of reactions with the arrow keys, Home and End.
 * Up and down cross to the previous and next grids, up from the first one
 * goes back to the search field.
 */
function handleGridKeyDown(event: KeyboardEvent<HTMLElement>, picker: HTMLElement | null) {
	const grid = event.currentTarget;
	const items = [...grid.querySelectorAll<HTMLElement>("[role=menuitem]")];
	const i = items.indexOf(document.activeElement as HTMLElement);
	if (!picker || i < 0) {
		return;
	}
	const grids = [...picker.querySelectorAll<HTMLElement>("[role=menu]")];
	const g = grids.indexOf(grid);
	const itemsOf = (el: HTMLElement | undefined) => [
		...(el?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []),
	];
	let next: HTMLElement | null | undefined;
	switch (event.key) {
		case "ArrowLeft":
			next = items[i - 1];
			break;
		case "ArrowRight":
			next = items[i + 1];
			break;
		case "ArrowUp":
			next =
				i >= COLUMNS
					? items[i - COLUMNS]
					: (itemsOf(grids[g - 1]).at(-1) ?? picker.querySelector<HTMLElement>("input"));
			break;
		case "ArrowDown":
			// To the last item if the next row is shorter
			next =
				i - (i % COLUMNS) + COLUMNS < items.length
					? items[Math.min(i + COLUMNS, items.length - 1)]
					: itemsOf(grids[g + 1])[0];
			break;
		case "Home":
			next = items[0];
			break;
		case "End":
			next = items.at(-1);
			break;
		default:
			return;
	}
	event.preventDefault();
	next?.focus();
}

interface ReactionPickerProps {
	onPick: (emoji: string) => void;
	/** How: picked from the keyboard, with Escape or with a pointer */
	onClose: (how: "keyboard" | "escape" | "pointer") => void;
	/** The button toggling the picker, which handles its own clicks */
	toggleRef: RefObject<HTMLButtonElement | null>;
}

function ReactionPicker({ onPick, onClose, toggleRef }: ReactionPickerProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState("");
	const [quick] = useState(quickReactions);
	const [position, setPosition] = useState<CSSProperties>({ opacity: 0 });

	// Below the toggle, or above it when there's no room, e.g. on the last
	// message. Positioned fixed: the chat log would clip it
	useLayoutEffect(() => {
		const rect = toggleRef.current?.getBoundingClientRect();
		const height = ref.current?.offsetHeight ?? 0;
		if (!rect) {
			return;
		}
		const right = window.innerWidth - rect.right;
		setPosition(
			rect.bottom + 4 + height > window.innerHeight && rect.top - 4 - height >= 0
				? { bottom: window.innerHeight - rect.top + 4, right }
				: { top: rect.bottom + 4, right },
		);
	}, [toggleRef]);

	usePopover(true, ref, toggleRef, (reason) => onClose(reason === "escape" ? "escape" : "pointer"));

	function pick(emoji: string, fromKeyboard: boolean) {
		rememberReaction(emoji);
		onPick(emoji);
		onClose(fromKeyboard ? "keyboard" : "pointer");
	}

	const results = query.trim() ? searchEmoji(query) : null;
	const choices = (emojis: string[], label: string) => (
		<div
			className="reaction-choices"
			role="menu"
			aria-label={label}
			onKeyDown={(event) => handleGridKeyDown(event, ref.current)}
		>
			{emojis.map((emoji) => (
				<button
					key={emoji}
					type="button"
					role="menuitem"
					className="reaction-choice"
					aria-label={`React with ${emoji}`}
					onClick={(event) => pick(emoji, event.detail === 0)}
				>
					{emoji}
				</button>
			))}
		</div>
	);

	return createPortal(
		<div
			className="reaction-picker"
			role="dialog"
			aria-label="Pick a reaction"
			ref={ref}
			style={position}
		>
			<input
				type="search"
				className="reaction-search"
				placeholder="Search emoji"
				aria-label="Search emoji"
				value={query}
				autoFocus
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && results?.[0]) {
						event.preventDefault();
						pick(results[0], true);
					} else if (event.key === "ArrowDown") {
						event.preventDefault();
						ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
					}
				}}
			/>
			{results ? (
				results.length > 0 ? (
					choices(results, "Search results")
				) : (
					<p className="reaction-empty">No emoji found</p>
				)
			) : (
				<>
					{choices(quick, "Frequently used")}
					<div className="reaction-all">
						{choices(
							EMOJIS.map(([emoji]) => emoji).filter((emoji) => !quick.includes(emoji)),
							"All reactions",
						)}
					</div>
				</>
			)}
		</div>,
		document.body,
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
	const openedFromKeyboard = useRef(false);

	// The focus was in the picker, which unmounts: give it back to keyboard
	// users. Like menus, Escape only does when opened from the keyboard,
	// the toolbar would stay shown otherwise.
	function close(how: "keyboard" | "escape" | "pointer") {
		setPicking(false);
		if (how === "keyboard" || (how === "escape" && openedFromKeyboard.current)) {
			toggleRef.current?.focus();
		}
	}

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
					onClick={(event) => {
						openedFromKeyboard.current = event.detail === 0;
						setPicking((p) => !p);
					}}
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
			{picking && <ReactionPicker onPick={onReact} onClose={close} toggleRef={toggleRef} />}
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
