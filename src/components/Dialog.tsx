import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";
import IconButton from "./IconButton";

interface DialogProps {
	title: ReactNode;
	/** Shown in a badge next to the title */
	icon?: LucideIcon;
	/** A short line under the title, e.g. the server it applies to */
	description?: ReactNode;
	onDismiss?: () => void;
	/** Buttons shown in the header, before the close button */
	actions?: ReactNode;
	children: ReactNode;
	size?: "sm" | "md" | "lg";
}

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The elements Tab can reach, leaving out the ones hidden by CSS */
function focusables(el: HTMLElement): HTMLElement[] {
	return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
		(child) => child.checkVisibility?.() ?? true,
	);
}

export default function Dialog({
	title,
	icon: Icon,
	description,
	onDismiss,
	actions,
	children,
	size = "md",
}: DialogProps) {
	const titleID = useId();
	const descriptionID = useId();
	const ref = useRef<HTMLDivElement>(null);
	// Captured on first render, before any autoFocus field steals focus
	const [prevFocus] = useState(() => document.activeElement as HTMLElement | null);
	// Read by the key handler, so that it isn't added again on every render
	const onDismissRef = useRef(onDismiss);
	useEffect(() => {
		onDismissRef.current = onDismiss;
	});

	useEffect(() => {
		const el = ref.current!;
		// React focuses autoFocus fields itself, keep that focus if any
		if (!el.contains(document.activeElement)) {
			(focusables(el)[0] ?? el).focus();
		}
		return () => prevFocus?.focus?.();
	}, [prevFocus]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			// A menu opened from the dialog closes first
			const dismiss = onDismissRef.current;
			if (event.key === "Escape" && dismiss && !document.querySelector("[role=menu]")) {
				event.stopPropagation();
				dismiss();
				return;
			}
			if (event.key !== "Tab") {
				return;
			}
			// Trap focus inside the dialog
			const focusable = focusables(ref.current!);
			if (focusable.length === 0) {
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			// Focus can end up outside, e.g. when the focused button unmounts
			// while the dialog shows a spinner: bring it back in
			if (!ref.current!.contains(document.activeElement)) {
				event.preventDefault();
				(event.shiftKey ? last : first).focus();
				return;
			}
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
	}, []);

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
				aria-describedby={description ? descriptionID : undefined}
				tabIndex={-1}
			>
				<header className="dialog-header">
					{Icon && (
						<span className="dialog-icon" aria-hidden="true">
							<Icon />
						</span>
					)}
					<div className="dialog-heading">
						<h2 id={titleID}>{title}</h2>
						{description && (
							<p className="dialog-description" id={descriptionID}>
								{description}
							</p>
						)}
					</div>
					{actions}
					{onDismiss && <IconButton icon={X} label="Close" onClick={onDismiss} />}
				</header>
				<div className="dialog-body">{children}</div>
			</div>
		</div>
	);
}
