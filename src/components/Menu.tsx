import {
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	type Ref,
} from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import usePopover from "./usePopover";

export interface MenuItem {
	key: string;
	icon: LucideIcon;
	label: string;
	danger?: boolean;
	/** Makes the item a radio: whether it's the chosen one */
	checked?: boolean;
	onClick: () => void;
}

/** Where to show the menu relative to its toggle */
export type MenuPlacement = "below-end" | "above-start";

export interface MenuHandle {
	/**
	 * Open the menu at a point, e.g. for a context menu. The opener gets
	 * the focus back, and handles its own clicks.
	 */
	openAt(x: number, y: number, opener?: HTMLElement): void;
	/** Open the menu next to a button, e.g. one of several sharing it */
	openFrom(opener: HTMLElement, fromKeyboard: boolean): void;
	close(): void;
}

interface MenuProps {
	ref?: Ref<MenuHandle>;
	items: MenuItem[];
	/** Accessible name of the menu */
	label: string;
	/** Without one, there's no toggle: the menu is opened through its ref */
	toggleLabel?: string;
	toggleIcon?: LucideIcon;
	toggleClassName?: string;
	/** Shown in the toggle after its icon */
	children?: ReactNode;
	placement?: MenuPlacement;
	onClose?: () => void;
}

/**
 * A button opening a menu. The menu is rendered in the body, positioned
 * fixed, so that containers clipping their overflow don't cut it.
 */
export default function Menu({
	ref,
	items,
	label,
	toggleLabel,
	toggleIcon: ToggleIcon,
	toggleClassName = "btn btn-sm",
	placement = "below-end",
	children,
	onClose,
}: MenuProps) {
	const [position, setPosition] = useState<CSSProperties | null>(null);
	const open = position !== null;
	// The toggle, or the element the menu was opened from
	const openerRef = useRef<HTMLElement | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	// Only give the focus back to the opener for keyboard users: after a
	// click, it would keep showing toggles only visible on focus or hover
	const fromKeyboard = useRef(false);

	function openFrom(opener: HTMLElement, keyboard: boolean) {
		openerRef.current = opener;
		fromKeyboard.current = keyboard;
		const rect = opener.getBoundingClientRect();
		if (placement === "above-start") {
			setPosition({ bottom: window.innerHeight - rect.top + 6, left: rect.left });
		} else {
			setPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
		}
	}

	function close() {
		setPosition(null);
		onClose?.();
	}

	function toggle(event: MouseEvent<HTMLButtonElement>) {
		if (open) {
			close();
		} else {
			openFrom(event.currentTarget, event.detail === 0);
		}
	}

	useImperativeHandle(ref, () => ({
		openAt: (x, y, opener) => {
			openerRef.current = opener ?? null;
			fromKeyboard.current = false;
			setPosition({ top: y, left: x });
		},
		openFrom,
		close,
	}));

	// Keep menus opened at a point inside the viewport
	useLayoutEffect(() => {
		const rect = menuRef.current?.getBoundingClientRect();
		if (!rect || typeof position?.left !== "number" || typeof position.top !== "number") {
			return;
		}
		const margin = 8;
		const left = Math.max(margin, Math.min(position.left, window.innerWidth - rect.width - margin));
		const top = Math.max(margin, Math.min(position.top, window.innerHeight - rect.height - margin));
		if (left !== position.left || top !== position.top) {
			setPosition({ top, left });
		}
	}, [position]);

	const menuItems = () =>
		Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? []);

	useEffect(() => {
		if (open) {
			menuItems()[0]?.focus({ preventScroll: true });
		}
	}, [open]);

	usePopover(open, menuRef, openerRef, (reason) => {
		close();
		if (reason === "escape" && fromKeyboard.current) {
			openerRef.current?.focus();
		}
	});

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === "Tab") {
			// Leave the menu from its opener: the focus moves on from there
			close();
			openerRef.current?.focus();
		} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const l = menuItems();
			const i = l.indexOf(document.activeElement as HTMLElement);
			const next = event.key === "ArrowDown" ? i + 1 : i - 1;
			l[(next + l.length) % l.length]?.focus();
		}
	}

	return (
		<>
			{toggleLabel && (
				<button
					type="button"
					className={toggleClassName}
					title={toggleLabel}
					aria-label={toggleLabel}
					aria-haspopup="menu"
					aria-expanded={open}
					onClick={toggle}
				>
					{ToggleIcon && <ToggleIcon aria-hidden="true" />}
					{children}
				</button>
			)}
			{open &&
				createPortal(
					<div
						className={"action-menu " + (position.bottom !== undefined ? "above" : "below")}
						role="menu"
						aria-label={label}
						ref={menuRef}
						style={position}
						onKeyDown={handleKeyDown}
					>
						{items.map(({ key, icon: Icon, label, danger, checked, onClick }) => (
							<button
								key={key}
								type="button"
								role={checked === undefined ? "menuitem" : "menuitemradio"}
								aria-checked={checked}
								className={"action-menu-item" + (danger ? " danger" : "")}
								onClick={(event) => {
									close();
									// The item unmounts: keyboard users would be left
									// with the focus on the page. Before onClick(), which
									// may move it elsewhere, e.g. to a dialog.
									if (event.detail === 0) {
										openerRef.current?.focus();
									}
									onClick();
								}}
							>
								<Icon aria-hidden="true" />
								{label}
							</button>
						))}
					</div>,
					document.body,
				)}
		</>
	);
}
