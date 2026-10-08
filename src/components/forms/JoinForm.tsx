import { useState, type FormEvent } from "react";
import { Hash } from "lucide-react";

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
			<div className="field">
				<label htmlFor="join-channel">Channel</label>
				<div className="input-group">
					<span className="input-addon" aria-hidden="true">
						<Hash />
					</span>
					<input
						type="text"
						id="join-channel"
						name="channel"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						autoFocus
						required
					/>
				</div>
			</div>

			<div className="dialog-actions">
				<button type="submit" className="btn btn-primary">
					Join
				</button>
			</div>
		</form>
	);
}
