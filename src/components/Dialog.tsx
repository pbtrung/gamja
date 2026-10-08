import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import IconButton from "./IconButton";

interface DialogProps {
	title: ReactNode;
	onDismiss?: () => void;
	children: ReactNode;
	size?: "sm" | "md" | "lg";
}

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Dialog({ title, onDismiss, children, size = "md" }: DialogProps) {
	const titleID = useId();
	const ref = useRef<HTMLDivElement>(null);
	// Captured on first render, before any autoFocus field steals focus
	const [prevFocus] = useState(() => document.activeElement as HTMLElement | null);

	useEffect(() => {
		const el = ref.current!;
		// React focuses autoFocus fields itself, keep that focus if any
		if (!el.contains(document.activeElement)) {
			const autofocus = el.querySelector<HTMLElement>("[data-autofocus]");
			(autofocus ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
		}
		return () => prevFocus?.focus?.();
	}, [prevFocus]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && onDismiss) {
				event.stopPropagation();
				onDismiss();
				return;
			}
			if (event.key !== "Tab") {
				return;
			}
			// Trap focus inside the dialog
			const focusable = Array.from(ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE));
			if (focusable.length === 0) {
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [onDismiss]);

	return (
		<div
			className="dialog-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) {
					onDismiss?.();
				}
			}}
		>
			<div
				ref={ref}
				className={`dialog dialog-${size}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleID}
				tabIndex={-1}
			>
				<header className="dialog-header">
					<h2 id={titleID}>{title}</h2>
					{onDismiss && <IconButton icon={X} label="Close" onClick={onDismiss} />}
				</header>
				<div className="dialog-body">{children}</div>
			</div>
		</div>
	);
}
