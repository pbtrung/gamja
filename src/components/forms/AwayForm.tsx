import { useState, type FormEvent } from "react";
import { Moon } from "lucide-react";

export default function AwayForm({
	message,
	onSubmit,
}: {
	message: string | null;
	onSubmit: (message: string) => void;
}) {
	const [value, setValue] = useState(message || "Away");

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		onSubmit(value.trim() || "Away");
	}

	return (
		<form onSubmit={handleSubmit}>
			<div className="field">
				<label htmlFor="away-message">Message</label>
				<input
					type="text"
					id="away-message"
					name="message"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onFocus={(e) => e.target.select()}
					autoFocus
				/>
			</div>

			<div className="dialog-actions">
				<button type="submit" className="btn btn-primary">
					<Moon aria-hidden="true" /> Set away
				</button>
			</div>
		</form>
	);
}
