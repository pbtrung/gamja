import { useEffect, type RefObject } from "react";

interface GlobalTypingOptions {
	inputRef: RefObject<HTMLTextAreaElement | null>;
	readOnly: boolean;
	commandOnly: boolean;
	focus: () => void;
	setText: (text: string) => void;
	normalizeNewlines: (s: string) => string;
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

/** Whether keys and pastes belong to another field or an open dialog */
function isElsewhere(): boolean {
	return isEditableFocused() || !!document.querySelector('[aria-modal="true"]');
}

/** Global listeners: start typing or paste anywhere to focus the composer */
export default function useGlobalTyping({
	inputRef,
	readOnly,
	commandOnly,
	focus,
	setText,
	normalizeNewlines,
}: GlobalTypingOptions): void {
	useEffect(() => {
		const handleWindowKeyDown = (event: KeyboardEvent) => {
			// Don't steal keys from editable fields or from an open dialog
			if (isElsewhere() || event.defaultPrevented) {
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

		const handleWindowPaste = (event: ClipboardEvent) => {
			// Like keys: not into an open dialog, only commands when command-only
			if (isElsewhere() || readOnly || !inputRef.current || !event.clipboardData) {
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
	}, [inputRef, readOnly, commandOnly, focus, setText, normalizeNewlines]);
}
