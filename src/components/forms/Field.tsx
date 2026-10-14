import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
	label: string;
	/** Shown in the input, before the text */
	icon?: LucideIcon;
	/** A button in the input, after the text, e.g. to show a password */
	action?: ReactNode;
}

/** A labeled input. Other props are the input's. */
export default function Field({ label, icon: Icon, action, id, type = "text", ...inputProps }: FieldProps) {
	const autoID = useId();
	const inputID = id ?? autoID;
	const input = <input type={type} id={inputID} {...inputProps} />;
	return (
		<div className="field">
			<label htmlFor={inputID}>{label}</label>
			{Icon || action ? (
				<div className="input-with-icon">
					{Icon && <Icon aria-hidden="true" />}
					{input}
					{action}
				</div>
			) : (
				input
			)}
		</div>
	);
}
