import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
	type Ref,
} from "react";
import { CornerUpRight, SendHorizontal, X } from "lucide-react";
import type { ReplyTo } from "../app/store";
import IconButton from "./IconButton";
import { computeAutocomplete, type Autocomplete } from "../lib/autocomplete";
import { splitMultiline, type MultilineLimits } from "../lib/irc";

/** How many sent messages each buffer remembers, see history below */
const HISTORY_SIZE = 100;

export interface ComposerHandle {
	focus(): void;
}

interface ComposerProps {
	ref?: Ref<ComposerHandle>;
	/** Identifies the buffer: each one keeps its own unsent text */
	draftKey?: unknown;
	readOnly: boolean;
	commandOnly: boolean;
	/** Extend the input to the chat pane's edges, with square corners */
	edgeToEdgeInput?: boolean;
	maxLen?: number;
	/** Set if messages may span several lines (draft/multiline) */
	multiline?: MultilineLimits | null;
	/** Returns false to keep the text, e.g. when it couldn't be sent */
	onSubmit: (text: string) => boolean | void;
	autocomplete: (prefix: string) => string[];
	replyTo?: ReplyTo | null;
	onCancelReply?: () => void;
	/** Called when the text changes, e.g. to send typing notifications */
	onTextChange?: (text: string) => void;
	/** Rendered above the input, e.g. typing notifications */
	status?: ReactNode;
}

function isEditableFocused(): boolean {
	const el = document.activeElement;
	if (!el || el === document.body) {
		return false;
	}
	switch (el.tagName.toLowerCase()) {
		case "section":
		case "a":
		case "main":
			return false;
		default:
			return true;
	}
}

export default function Composer({
	ref,
	draftKey,
	readOnly,
	commandOnly,
	edgeToEdgeInput = true,
	maxLen,
	multiline,
	onSubmit,
	autocomplete,
	replyTo,
	onCancelReply,
	onTextChange,
	status,
}: ComposerProps) {
	const [text, setText] = useState("");
	// Unsent text of the other buffers
	const [drafts, setDrafts] = useState(() => new Map<unknown, string>());
	const [prevDraftKey, setPrevDraftKey] = useState(draftKey);
	if (draftKey !== prevDraftKey) {
		const next = new Map(drafts);
		if (text) {
			next.set(prevDraftKey, text);
		}
		setText(next.get(draftKey) ?? "");
		next.delete(draftKey);
		setDrafts(next);
		setPrevDraftKey(draftKey);
	}
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const lastAutocomplete = useRef<Autocomplete | null>(null);
	// Sent messages per buffer, oldest first, recalled with Up and Down
	const history = useRef(new Map<unknown, string[]>());
	// Position in the history of the active buffer (its length when not
	// browsing it), and the text typed before browsing it
	const historyPos = useRef<{ key: unknown; index: number; typed: string } | null>(null);

	const focus = useCallback(() => {
		if (!inputRef.current) {
			return;
		}
		(document.activeElement as HTMLElement | null)?.blur?.(); // in case we're read-only
		inputRef.current.focus();
	}, []);
	useImperativeHandle(ref, () => ({ focus }), [focus]);

	// Grow the textarea with its content
	useEffect(() => {
		const el = inputRef.current;
		if (!el) {
			return;
		}
		el.style.height = "auto";
		el.style.height = Math.min(el.scrollHeight, 200) + "px";
	}, [text]);

	const onTextChangeRef = useRef(onTextChange);
	useEffect(() => {
		onTextChangeRef.current = onTextChange;
	});
	const textDraftKey = useRef(draftKey);
	useEffect(() => {
		// Text restored when switching buffers isn't typing
		if (textDraftKey.current !== draftKey) {
			textDraftKey.current = draftKey;
			return;
		}
		onTextChangeRef.current?.(text);
	}, [text, draftKey]);

	function submit() {
		if (!text || tooLong) {
			return;
		}
		if (onSubmit(text) === false) {
			return;
		}
		const sent = history.current.get(draftKey) ?? [];
		if (sent.at(-1) !== text) {
			sent.push(text);
			sent.splice(0, sent.length - HISTORY_SIZE);
		}
		history.current.set(draftKey, sent);
		historyPos.current = null;
		setText("");
		lastAutocomplete.current = null;
	}

	/** Recall an older (-1) or newer (1) sent message, returns whether there was one */
	function browseHistory(delta: -1 | 1): boolean {
		const sent = history.current.get(draftKey) ?? [];
		let pos = historyPos.current;
		if (!pos || pos.key !== draftKey) {
			pos = { key: draftKey, index: sent.length, typed: text };
		}
		const index = pos.index + delta;
		if (index < 0 || index > sent.length) {
			return false;
		}
		historyPos.current = { ...pos, index };
		const recalled = index === sent.length ? pos.typed : sent[index];
		setText(recalled);
		lastAutocomplete.current = null;
		requestAnimationFrame(() => {
			const input = inputRef.current;
			if (input) {
				input.selectionStart = input.selectionEnd = recalled.length;
			}
		});
		return true;
	}

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		submit();
	}

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		const input = event.currentTarget;

		if (event.key === "Escape" && replyTo) {
			event.preventDefault();
			onCancelReply?.();
			return;
		}

		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			submit();
			return;
		}

		// Up on the first line and Down on the last one browse the sent
		// messages, other lines move the caret
		const collapsed = input.selectionStart === input.selectionEnd;
		const noModifier = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
		if (
			collapsed &&
			noModifier &&
			((event.key === "ArrowUp" && !text.slice(0, input.selectionStart).includes("\n")) ||
				(event.key === "ArrowDown" && !text.slice(input.selectionEnd).includes("\n")))
		) {
			if (browseHistory(event.key === "ArrowUp" ? -1 : 1)) {
				event.preventDefault();
			}
			return;
		}

		if (event.key !== "Tab" || !collapsed) {
			return;
		}

		const ac = computeAutocomplete(
			text,
			input.selectionStart,
			lastAutocomplete.current,
			event.shiftKey,
			autocomplete,
		);
		if (!ac) {
			return;
		}
		event.preventDefault();
		lastAutocomplete.current = ac;
		setText(ac.text);
		requestAnimationFrame(() => {
			input.selectionStart = input.selectionEnd = ac.caretPos;
		});
	}

	// Without multi-line message support, flatten newlines
	const normalizeNewlines = useCallback(
		(s: string) => (multiline ? s.replace(/\r\n?/g, "\n") : s.replace(/\r?\n/g, " ")),
		[multiline],
	);

	function handleChange(value: string) {
		setText(normalizeNewlines(value));
		if (readOnly && !value) {
			inputRef.current?.blur();
		}
	}

	// Global listeners: start typing anywhere to focus the composer
	useEffect(() => {
		const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
			// Don't steal keys from editable fields or from an open dialog
			if (
				isEditableFocused() ||
				document.querySelector('[aria-modal="true"]') ||
				event.defaultPrevented
			) {
				return;
			}
			// If a modifier is pressed, reserve for key bindings.
			if (event.altKey || event.ctrlKey || event.metaKey) {
				return;
			}
			// Ignore events that don't produce a single (possibly combined)
			// character
			if ([...event.key].length !== 1) {
				return;
			}
			if (readOnly || (commandOnly && event.key !== "/")) {
				return;
			}
			if (inputRef.current?.value) {
				focus();
				return;
			}

			event.preventDefault();
			setText(event.key);
			focus();
		};

		const handleWindowPaste = (event: globalThis.ClipboardEvent) => {
			// Like keys: not into an open dialog, only commands when command-only
			if (
				isEditableFocused() ||
				document.querySelector('[aria-modal="true"]') ||
				readOnly ||
				!inputRef.current ||
				!event.clipboardData
			) {
				return;
			}

			if (event.clipboardData.files.length > 0) {
				return;
			}

			const pasted = event.clipboardData.getData("text");
			if (commandOnly && !inputRef.current.value && !pasted.startsWith("/")) {
				return;
			}
			event.preventDefault();
			const input = inputRef.current;
			input.focus();
			input.setRangeText(normalizeNewlines(pasted), input.selectionStart, input.selectionEnd, "end");
			setText(input.value);
		};

		window.addEventListener("keydown", handleWindowKeyDown);
		window.addEventListener("paste", handleWindowPaste);
		return () => {
			window.removeEventListener("keydown", handleWindowKeyDown);
			window.removeEventListener("paste", handleWindowPaste);
		};
	}, [readOnly, commandOnly, focus, normalizeNewlines]);

	const classes: string[] = [];
	if (edgeToEdgeInput) {
		classes.push("edge-to-edge");
	}
	if (readOnly && !text) {
		classes.push("read-only");
	}

	const label = commandOnly ? "Type a command (see /help)" : "Type a message";
	// Commands aren't sent as is ("//" escapes a message starting with "/")
	const isCommand = text.startsWith("/") && !text.startsWith("//");
	let tooLong = false;
	if (!isCommand && multiline && text.includes("\n")) {
		// Each line is limited by the server's multiline limits instead
		const bytes = new TextEncoder().encode(text.replace(/\n/g, "")).length;
		const lines = splitMultiline(text, maxLen ?? Infinity).length;
		tooLong = bytes > multiline.maxBytes || lines > multiline.maxLines;
	} else if (!isCommand && maxLen !== undefined) {
		tooLong = new TextEncoder().encode(text).length > maxLen;
	}

	return (
		<form id="composer" className={classes.join(" ")} onSubmit={handleSubmit}>
			{status}
			{replyTo && (
				<div className="composer-reply">
					<CornerUpRight aria-hidden="true" />
					<span className="composer-reply-text">
						Replying to <strong>{replyTo.nick}</strong>: {replyTo.text}
					</span>
					<IconButton icon={X} label="Cancel reply" onClick={onCancelReply} />
				</div>
			)}
			<div className={"composer-box" + (tooLong ? " too-long" : "")}>
				<textarea
					name="text"
					className="composer-input"
					ref={inputRef}
					value={text}
					rows={1}
					autoComplete="off"
					placeholder={label}
					aria-label={label}
					aria-invalid={tooLong || undefined}
					enterKeyHint="send"
					onChange={(event) => handleChange(event.target.value)}
					onKeyDown={handleKeyDown}
				/>
				<div className="composer-buttons">
					<IconButton
						type="submit"
						icon={SendHorizontal}
						label="Send"
						className="composer-send"
						disabled={!text || tooLong}
					/>
				</div>
			</div>
		</form>
	);
}
