import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	type ClipboardEvent,
	type DragEvent,
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
	type Ref,
} from "react";
import { CornerUpRight, Paperclip, SendHorizontal, X } from "lucide-react";
import type { ReplyTo } from "../app/store";
import type Client from "../lib/client";
import { uploadFile } from "../lib/filehost";
import IconButton from "./IconButton";
import { computeAutocomplete, type Autocomplete } from "../lib/autocomplete";

export interface ComposerHandle {
	focus(): void;
}

interface ComposerProps {
	ref?: Ref<ComposerHandle>;
	client: Client | null;
	readOnly: boolean;
	commandOnly: boolean;
	maxLen?: number;
	onSubmit: (text: string) => void;
	onError: (err: unknown) => void;
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
	client,
	readOnly,
	commandOnly,
	maxLen,
	onSubmit,
	onError,
	autocomplete,
	replyTo,
	onCancelReply,
	onTextChange,
	status,
}: ComposerProps) {
	const [text, setText] = useState("");
	const [uploading, setUploading] = useState(false);
	const [dragging, setDragging] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const lastAutocomplete = useRef<Autocomplete | null>(null);
	const uploadCount = useRef(0);
	const uploadAbort = useRef<AbortController | null>(null);

	const focus = useCallback(() => {
		if (!inputRef.current) {
			return;
		}
		(document.activeElement as HTMLElement | null)?.blur?.(); // in case we're read-only
		inputRef.current.focus();
	}, []);
	useImperativeHandle(ref, () => ({ focus }), [focus]);

	const canUploadFiles = Boolean(client?.isupport.filehost()) && !readOnly;

	// Grow the textarea with its content
	useEffect(() => {
		const el = inputRef.current;
		if (!el) {
			return;
		}
		el.style.height = "auto";
		el.style.height = Math.min(el.scrollHeight, 200) + "px";
	}, [text]);

	const uploadFileList = useCallback(
		async (fileList: FileList | File[]) => {
			if (!client) {
				return;
			}
			if (!uploadAbort.current) {
				uploadAbort.current = new AbortController();
			}
			const signal = uploadAbort.current.signal;
			uploadCount.current++;
			setUploading(true);

			let urls: URL[];
			try {
				urls = await Promise.all(
					Array.from(fileList).map((file) => uploadFile(client, file, signal)),
				);
			} catch (err) {
				if (!signal.aborted) {
					onError(new Error("Failed to upload files", { cause: err }));
				}
				return;
			} finally {
				uploadCount.current--;
				if (uploadCount.current === 0) {
					uploadAbort.current = null;
					setUploading(false);
				}
			}

			setText((text) => (text ? text + " " : "") + urls.join(" "));
		},
		[client, onError],
	);

	const onTextChangeRef = useRef(onTextChange);
	useEffect(() => {
		onTextChangeRef.current = onTextChange;
	});
	useEffect(() => {
		onTextChangeRef.current?.(text);
	}, [text]);

	function submit() {
		if (!text || tooLong) {
			return;
		}
		onSubmit(text);
		setText("");
		lastAutocomplete.current = null;
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

		if (event.key !== "Tab" || input.selectionStart !== input.selectionEnd) {
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

	function handleChange(value: string) {
		// Multi-line messages aren't supported: flatten pasted newlines
		setText(value.replace(/\r?\n/g, " "));
		if (readOnly && !value) {
			inputRef.current?.blur();
		}
	}

	async function handlePaste(event: ClipboardEvent) {
		if (event.clipboardData.files.length === 0 || !canUploadFiles) {
			return;
		}
		event.preventDefault();
		await uploadFileList(event.clipboardData.files);
	}

	function isDraggingFiles(event: DragEvent) {
		return Array.from(event.dataTransfer.items).every((item) => item.kind === "file");
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
			if (isEditableFocused() || readOnly || !inputRef.current || !event.clipboardData) {
				return;
			}

			if (event.clipboardData.files.length > 0) {
				if (canUploadFiles) {
					event.preventDefault();
					uploadFileList(event.clipboardData.files);
				}
				return;
			}

			const pasted = event.clipboardData.getData("text");
			event.preventDefault();
			const input = inputRef.current;
			input.focus();
			input.setRangeText(
				pasted.replace(/\r?\n/g, " "),
				input.selectionStart,
				input.selectionEnd,
				"end",
			);
			setText(input.value);
		};

		window.addEventListener("keydown", handleWindowKeyDown);
		window.addEventListener("paste", handleWindowPaste);
		return () => {
			window.removeEventListener("keydown", handleWindowKeyDown);
			window.removeEventListener("paste", handleWindowPaste);
		};
	}, [readOnly, commandOnly, canUploadFiles, focus, uploadFileList]);

	const classes: string[] = [];
	if (readOnly && !text) {
		classes.push("read-only");
	}
	if (uploading) {
		classes.push("uploading");
	}
	if (dragging) {
		classes.push("dragging");
	}

	const label = commandOnly ? "Type a command (see /help)" : "Type a message";
	// Commands aren't sent as is ("//" escapes a message starting with "/")
	const isCommand = text.startsWith("/") && !text.startsWith("//");
	const tooLong = maxLen !== undefined && !isCommand && new TextEncoder().encode(text).length > maxLen;

	return (
		<form
			id="composer"
			className={classes.join(" ")}
			ref={formRef}
			onSubmit={handleSubmit}
			onDragEnter={(event) => {
				if (canUploadFiles && isDraggingFiles(event)) {
					setDragging(true);
				}
			}}
			onDragLeave={(event) => {
				// ignore spurious dragleave events triggered by moving over child elements
				if (formRef.current?.contains(event.relatedTarget as Node)) {
					return;
				}
				setDragging(false);
			}}
			onDragOver={(event) => {
				if (canUploadFiles && isDraggingFiles(event)) {
					event.preventDefault();
				}
			}}
			onDrop={async (event) => {
				if (event.dataTransfer.files.length === 0 || !canUploadFiles) {
					return;
				}
				event.preventDefault();
				// dragleave does not fire after a drop, so reset manually.
				setDragging(false);
				inputRef.current?.focus();
				await uploadFileList(event.dataTransfer.files);
			}}
		>
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
					onPaste={handlePaste}
				/>
				<div className="composer-buttons">
					{canUploadFiles && uploading && (
						<button
							type="button"
							className="icon-btn composer-spinner"
							title="Cancel upload"
							aria-label="Cancel upload"
							onClick={() => uploadAbort.current?.abort()}
						>
							<span className="spinner" aria-hidden="true" />
							<X className="x-icon" aria-hidden="true" />
						</button>
					)}
					{canUploadFiles && (
						<IconButton
							icon={Paperclip}
							label="Upload file"
							onClick={() => {
								inputRef.current?.focus();
								fileInputRef.current?.click();
							}}
						/>
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
			{canUploadFiles && (
				<input
					type="file"
					ref={fileInputRef}
					multiple
					hidden
					onChange={async (event) => {
						const files = event.target.files;
						if (!files || files.length === 0) {
							return;
						}
						await uploadFileList(files);
						event.target.value = "";
					}}
				/>
			)}
		</form>
	);
}
