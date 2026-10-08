import type { Ref } from "react";
import type { LucideIcon } from "lucide-react";

interface IconButtonProps {
	icon: LucideIcon;
	/** Tooltip and accessible name */
	label: string;
	className?: string;
	type?: "button" | "submit";
	disabled?: boolean;
	ref?: Ref<HTMLButtonElement>;
	/** Toggle buttons: whether the toggle is on */
	pressed?: boolean;
	/** Buttons opening a menu: whether it's open */
	expanded?: boolean;
	hasPopup?: "menu";
	onClick?: () => void;
}

/** A button showing only an icon. */
export default function IconButton({
	icon: Icon,
	label,
	className,
	type = "button",
	disabled,
	ref,
	pressed,
	expanded,
	hasPopup,
	onClick,
}: IconButtonProps) {
	return (
		<button
			ref={ref}
			type={type}
			className={"icon-btn" + (className ? " " + className : "")}
			title={label}
			aria-label={label}
			aria-pressed={pressed}
			aria-expanded={expanded}
			aria-haspopup={hasPopup}
			disabled={disabled}
			onClick={onClick}
		>
			<Icon aria-hidden="true" />
		</button>
	);
}
