import { Search, X } from "lucide-react";
import IconButton from "./IconButton";

interface FilterInputProps {
	id?: string;
	value: string;
	onChange: (value: string) => void;
	label: string;
	placeholder: string;
}

/** Shared sidebar search, matching the buffer and member filters. */
export default function FilterInput({ id, value, onChange, label, placeholder }: FilterInputProps) {
	return (
		<div className="filter-input">
			<Search aria-hidden="true" />
			<input
				type="search"
				id={id}
				aria-label={label}
				placeholder={placeholder}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape" && value) {
						event.stopPropagation();
						onChange("");
					} else if (event.key === "ArrowDown") {
						const panel = event.currentTarget.closest("nav, aside");
						const first = panel?.querySelector<HTMLElement>("[role=tab], .member-items a");
						if (first) {
							event.preventDefault();
							first.focus();
						}
					}
				}}
			/>
			{value && (
				<IconButton
					icon={X}
					label={`Clear ${label.toLowerCase()}`}
					onClick={(event) => {
						onChange("");
						event.currentTarget.parentElement?.querySelector("input")?.focus();
					}}
				/>
			)}
		</div>
	);
}
