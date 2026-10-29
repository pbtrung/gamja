import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
	type Ref,
} from "react";
import { AtSign, CornerUpRight, SendHorizontal, X } from "lucide-react";
import type { ReplyTo } from "../app/store";
import IconButton from "./IconButton";
import useMediaQuery from "./useMediaQuery";
import useDrafts from "./composer/useDrafts";
import useGlobalTyping from "./composer/useGlobalTyping";
import useInputHistory from "./composer/useInputHistory";
import useTextChange from "./composer/useTextChange";
import { isTooLong } from "./composer/messageLength";
import { computeAutocomplete, type Autocomplete } from "../lib/autocomplete";
import type { MultilineLimits } from "../lib/irc";

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
	const [text, setText] = useDrafts(draftKey);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const lastAutocomplete = useRef<Autocomplete | null>(null);
	const history = useInputHistory();

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

	useTextChange(text, draftKey, onTextChange);

	const tooLong = isTooLong(text, maxLen, multiline);

	function submit() {
		if (!text || tooLong) {
			return;
		}
		if (onSubmit(text) === false) {
			return;
		}
		history.add(draftKey, text);
		setText("");
		lastAutocomplete.current = null;
	}

	/** Recall an older (-1) or newer (1) sent message, returns whether there was one */
	function browseHistory(delta: -1 | 1): boolean {
		const recalled = history.browse(draftKey, delta, text);
		if (recalled === null) {
			return false;
		}
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

		if (event.key === "Tab" && collapsed && complete(input, event.shiftKey)) {
			event.preventDefault();
		}
	}

	/** Complete the word before the caret, or cycle through the matches.
	 * Returns whether there was a match. */
	function complete(input: HTMLTextAreaElement, backwards: boolean): boolean {
		const ac = computeAutocomplete(
			text,
			input.selectionStart,
			lastAutocomplete.current,
			backwards,
			autocomplete,
		);
		if (!ac) {
			return false;
		}
		lastAutocomplete.current = ac;
		setText(ac.text);
		requestAnimationFrame(() => {
			input.selectionStart = input.selectionEnd = ac.caretPos;
		});
		return true;
	}

	// Touch keyboards have no Tab key: a button completes nicks instead
	const touchScreen = useMediaQuery("(hover: none)");

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

	useGlobalTyping({ inputRef, readOnly, commandOnly, focus, setText, normalizeNewlines });

	const classes: string[] = [];
	if (edgeToEdgeInput) {
		classes.push("edge-to-edge");
	}
	if (readOnly && !text) {
		classes.push("read-only");
	}

	const label = commandOnly ? "Type a command (see /help)" : "Type a message";

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
					{touchScreen && !readOnly && (
						<button
							type="button"
							className="icon-btn composer-complete"
							title="Complete nickname"
							aria-label="Complete nickname"
							// Keep the focus, and the on-screen keyboard, in the input
							onPointerDown={(event) => event.preventDefault()}
							onClick={() => {
								const input = inputRef.current;
								if (input && input.selectionStart === input.selectionEnd) {
									complete(input, false);
								}
							}}
						>
							<AtSign aria-hidden="true" />
						</button>
					)}
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
