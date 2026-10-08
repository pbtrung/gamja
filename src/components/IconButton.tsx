import type { LucideIcon } from "lucide-react";

interface IconButtonProps {
	icon: LucideIcon;
	/** Tooltip and accessible name */
	label: string;
	className?: string;
	type?: "button" | "submit";
	disabled?: boolean;
	onClick?: () => void;
}

/** A button showing only an icon. */
export default function IconButton({
	icon: Icon,
	label,
	className,
	type = "button",
	disabled,
	onClick,
}: IconButtonProps) {
	return (
		<button
			type={type}
			className={"icon-btn" + (className ? " " + className : "")}
			title={label}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
		>
			<Icon aria-hidden="true" />
		</button>
	);
}
