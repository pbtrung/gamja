import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { MenuItem } from "../Menu";

interface ActionButtonProps {
	icon: LucideIcon;
	label: string;
	danger?: boolean;
	iconOnly?: boolean;
	className?: string;
	/** Extra information for assistive technologies */
	description?: string;
	/** Panel toggles: whether the panel is open, and its ID */
	expanded?: boolean;
	controls?: string;
	onClick: () => void;
	children?: ReactNode;
}

/** A header action: a button on wide screens, a menu item on small ones */
export interface Action extends MenuItem {
	iconOnly?: boolean;
}

export default function ActionButton({
	icon: Icon,
	label,
	danger,
	iconOnly,
	className,
	description,
	expanded,
	controls,
	onClick,
	children,
}: ActionButtonProps) {
	return (
		<button
			type="button"
			className={`btn btn-sm ${danger ? "btn-danger-outline" : ""} ${className || ""}`}
			title={label}
			aria-label={iconOnly ? label : undefined}
			aria-description={description}
			aria-expanded={expanded}
			aria-controls={controls}
			onClick={onClick}
		>
			<Icon aria-hidden="true" />
			{iconOnly ? null : <span className="action-label">{label}</span>}
			{children}
		</button>
	);
}
