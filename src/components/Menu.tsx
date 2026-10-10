import {
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent,
	type ReactNode,
	type Ref,
} from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

export interface MenuItem {
	key: string;
	icon: LucideIcon;
	label: string;
	danger?: boolean;
	onClick: () => void;
}

/** Where to show the menu relative to its toggle */
export type MenuPlacement = "below-end" | "above-start";

export interface MenuHandle {
	/** Open the menu at a point, e.g. for a context menu */
	openAt(x: number, y: number): void;
}

interface MenuProps {
	ref?: Ref<MenuHandle>;
	items: MenuItem[];
	/** Accessible name of the menu */
	label: string;
	toggleLabel: string;
	toggleIcon?: LucideIcon;
	toggleClassName?: string;
	/** Shown in the toggle after its icon */
	children?: ReactNode;
	placement?: MenuPlacement;
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
}: MenuProps) {
	const [position, setPosition] = useState<CSSProperties | null>(null);
	const open = position !== null;
	const toggleRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	// Only give the focus back to the toggle for keyboard users: after a
	// click, it would keep showing toggles only visible on focus or hover
	const fromKeyboard = useRef(false);

	function toggle(event: MouseEvent) {
		fromKeyboard.current = event.detail === 0;
		const rect = toggleRef.current?.getBoundingClientRect();
		if (open || !rect) {
			setPosition(null);
		} else if (placement === "above-start") {
			setPosition({ bottom: window.innerHeight - rect.top + 6, left: rect.left });
		} else {
			setPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
		}
	}

	useImperativeHandle(
		ref,
		() => ({
			openAt: (x, y) => {
				fromKeyboard.current = false;
				setPosition({ top: y, left: x });
			},
		}),
		[],
	);

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

	useEffect(() => {
		if (!open) {
			return;
		}
		const menuItems = () =>
			Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
		menuItems()[0]?.focus({ preventScroll: true });
		const close = () => {
			setPosition(null);
			if (fromKeyboard.current) {
				toggleRef.current?.focus();
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				close();
			} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const l = menuItems();
				const i = l.indexOf(document.activeElement as HTMLElement);
				const next = event.key === "ArrowDown" ? i + 1 : i - 1;
				l[(next + l.length) % l.length]?.focus();
			}
		};
		const handlePointer = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!menuRef.current?.contains(target) && !toggleRef.current?.contains(target)) {
				setPosition(null);
			}
		};
		window.addEventListener("keydown", handleKeyDown, true);
		window.addEventListener("pointerdown", handlePointer, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
			window.removeEventListener("pointerdown", handlePointer, true);
		};
	}, [open]);

	return (
		<>
			<button
				type="button"
				ref={toggleRef}
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
			{open &&
				createPortal(
					<div
						className={"action-menu " + (position.bottom !== undefined ? "above" : "below")}
						role="menu"
						aria-label={label}
						ref={menuRef}
						style={position}
					>
						{items.map(({ key, icon: Icon, label, danger, onClick }) => (
							<button
								key={key}
								type="button"
								role="menuitem"
								className={"action-menu-item" + (danger ? " danger" : "")}
								onClick={() => {
									setPosition(null);
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
