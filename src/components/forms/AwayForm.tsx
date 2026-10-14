import { useState, type FormEvent } from "react";
import { Moon } from "lucide-react";
import DialogActions from "./DialogActions";
import Field from "./Field";

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
			<Field
				label="Message"
				name="message"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onFocus={(e) => e.target.select()}
				autoFocus
			/>

			<DialogActions label="Set away" icon={Moon} />
		</form>
	);
}
