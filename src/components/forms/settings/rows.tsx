import { useId, useState, type CSSProperties } from "react";
import Switch from "../Switch";

interface ToggleRowProps {
	name: string;
	label: string;
	hint?: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (checked: boolean) => void;
}

/** A setting with a label and a hint on the left and a switch on the right */
export function ToggleRow({ name, label, hint, checked, disabled, onChange }: ToggleRowProps) {
	const id = useId();
	return (
		<div className="settings-row">
			<div className="settings-row-text">
				<label htmlFor={id + "-input"}>{label}</label>
				{hint && (
					<span className="settings-row-hint" id={id + "-hint"}>
						{hint}
					</span>
				)}
			</div>
			<Switch
				id={id + "-input"}
				name={name}
				checked={checked}
				disabled={disabled}
				aria-describedby={hint ? id + "-hint" : undefined}
				onChange={onChange}
			/>
		</div>
	);
}

interface NumberRowProps {
	name: string;
	label: string;
	hint: string;
	min: number;
	max: number;
	value: number;
	onChange: (value: number) => void;
}

/** A setting with a label and a hint on the left and an integer on the right.
 * onChange only gets integers within bounds: an invalid input is reset to the
 * current value when leaving it. */
export function NumberRow({ name, label, hint, min, max, value, onChange }: NumberRowProps) {
	const id = useId();
	const [text, setText] = useState(String(value));
	// Show the new value when it changes elsewhere
	const [shown, setShown] = useState(value);
	if (value !== shown) {
		setShown(value);
		setText(String(value));
	}

	function handleChange(s: string) {
		setText(s);
		const n = Number(s);
		if (s.trim() !== "" && Number.isInteger(n) && n >= min && n <= max) {
			onChange(n);
		}
	}

	return (
		<div className="settings-row">
			<div className="settings-row-text">
				<label htmlFor={id + "-input"}>{label}</label>
				<span className="settings-row-hint" id={id + "-hint"}>
					{hint}
				</span>
			</div>
			<input
				type="number"
				id={id + "-input"}
				className="settings-number"
				name={name}
				min={min}
				max={max}
				step={1}
				style={{ "--digits": String(max).length } as CSSProperties}
				value={text}
				aria-describedby={id + "-hint"}
				onChange={(event) => handleChange(event.target.value)}
				onBlur={() => setText(String(value))}
			/>
		</div>
	);
}

interface SegmentedRowProps<T> {
	name: string;
	label: string;
	hint: string;
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
}

/** A setting with a label and a hint on the left and a few choices on the right */
export function SegmentedRow<T extends string | number>({
	name,
	label,
	hint,
	options,
	value,
	onChange,
}: SegmentedRowProps<T>) {
	const id = useId();
	return (
		<div className="settings-row">
			<div className="settings-row-text">
				<span id={id + "-label"}>{label}</span>
				<span className="settings-row-hint" id={id + "-hint"}>
					{hint}
				</span>
			</div>
			<div
				className="segmented"
				role="radiogroup"
				aria-labelledby={id + "-label"}
				aria-describedby={id + "-hint"}
			>
				{options.map((option) => (
					<label
						key={option.value}
						className={"segmented-option" + (value === option.value ? " selected" : "")}
					>
						<input
							type="radio"
							name={name}
							value={option.value}
							checked={value === option.value}
							onChange={() => onChange(option.value)}
						/>
						{option.label}
					</label>
				))}
			</div>
		</div>
	);
}

interface SelectRowProps<T> {
	name: string;
	label: string;
	hint?: string;
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
}

/** A setting with a label and a hint on the left and a dropdown list on the right */
export function SelectRow<T extends string>({
	name,
	label,
	hint,
	options,
	value,
	onChange,
}: SelectRowProps<T>) {
	const id = useId();
	return (
		<div className="settings-row">
			<div className="settings-row-text">
				<label htmlFor={id + "-input"}>{label}</label>
				{hint && (
					<span className="settings-row-hint" id={id + "-hint"}>
						{hint}
					</span>
				)}
			</div>
			<select
				id={id + "-input"}
				className="settings-select"
				name={name}
				value={value}
				aria-describedby={hint ? id + "-hint" : undefined}
				onChange={(event) => onChange(event.target.value as T)}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}
