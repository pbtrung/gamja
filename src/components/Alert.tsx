import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";

interface AlertProps {
	className?: string;
	/** Shown after the message, e.g. a button dismissing it */
	action?: ReactNode;
	children: ReactNode;
}

/** An error message, announced by assistive technologies. */
export default function Alert({ className, action, children }: AlertProps) {
	return (
		<div className={"alert alert-danger" + (className ? " " + className : "")} role="alert">
			<CircleAlert aria-hidden="true" />
			<div className="alert-text">{children}</div>
			{action}
		</div>
	);
}
