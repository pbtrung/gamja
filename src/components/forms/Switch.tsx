import type { InputHTMLAttributes, ReactNode } from "react";

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
	onChange: (checked: boolean) => void;
}

/** A checkbox looking like a switch. Other props are the input's. */
export default function Switch({ onChange, ...inputProps }: SwitchProps) {
	return (
		<input
			type="checkbox"
			className="switch"
			{...inputProps}
			onChange={(event) => onChange(event.target.checked)}
		/>
	);
}

/** A switch with its label on the left */
export function SwitchRow({ children, ...switchProps }: SwitchProps & { children: ReactNode }) {
	return (
		<label className="switch-row">
			<span>{children}</span>
			<Switch {...switchProps} />
		</label>
	);
}
