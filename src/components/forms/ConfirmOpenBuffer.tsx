import type { FormEvent } from "react";
import { ExternalLink } from "lucide-react";
import DialogActions from "./DialogActions";

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
			<DialogActions label="Open" icon={ExternalLink} autoFocus />
		</form>
	);
}
