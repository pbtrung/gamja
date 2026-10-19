import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface DialogActionsProps {
	/** Label of the submit button */
	label: string;
	icon?: LucideIcon;
	autoFocus?: boolean;
	/** While the submission is being handled */
	disabled?: boolean;
	/** Other buttons, before the submit one */
	children?: ReactNode;
}

/** The buttons at the bottom of a dialog's form, ending with its submit button. */
export default function DialogActions({
	label,
	icon: Icon,
	autoFocus,
	disabled,
	children,
}: DialogActionsProps) {
	return (
		<div className="dialog-actions">
			{children}
			<button type="submit" className="btn btn-primary" autoFocus={autoFocus} disabled={disabled}>
				{Icon && <Icon aria-hidden="true" />}
				{label}
			</button>
		</div>
	);
}
