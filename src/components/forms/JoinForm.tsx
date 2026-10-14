import { useState, type FormEvent } from "react";
import { LogIn, MessagesSquare } from "lucide-react";
import DialogActions from "./DialogActions";
import Field from "./Field";

export default function JoinForm({
	channel,
	onSubmit,
}: {
	channel?: string;
	onSubmit: (channel: string) => void;
}) {
	const [value, setValue] = useState(channel || "#");

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		onSubmit(value);
	}

	return (
		<form onSubmit={handleSubmit}>
			<Field
				label="Channel"
				icon={MessagesSquare}
				name="channel"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				autoFocus
				required
			/>

			<DialogActions label="Join" icon={LogIn} />
		</form>
	);
}
