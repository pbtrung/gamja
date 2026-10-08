import type { FormEvent } from "react";
import { ExternalLink } from "lucide-react";

export default function ConfirmOpenBuffer({
	name,
	isChannel,
	networkName,
	onSubmit,
}: {
	name: string;
	isChannel: boolean;
	networkName: string | null;
	onSubmit: () => void;
}) {
	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		onSubmit();
	}

	return (
		<form onSubmit={handleSubmit}>
			<p className="dialog-text">
				Do you want to open a new buffer for {isChannel ? "channel" : "user"} <strong>{name}</strong>
				{networkName ? ` on ${networkName}` : null}?
			</p>
			<div className="dialog-actions">
				<button type="submit" className="btn btn-primary" autoFocus>
					<ExternalLink aria-hidden="true" /> Open
				</button>
			</div>
		</form>
	);
}
