import { useState, type FormEvent } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import DialogActions from "./DialogActions";
import { Linkified } from "../RichText";
import Field from "./Field";

export default function VerifyForm({
	account,
	message,
	onSubmit,
}: {
	account: string;
	message: string;
	onSubmit: (code: string) => void;
}) {
	const [code, setCode] = useState("");

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		onSubmit(code);
	}

	return (
		<form onSubmit={handleSubmit}>
			<p className="dialog-text">
				Your account <strong>{account}</strong> has been created, but a verification code is required
				to complete the registration.
			</p>

			<p className="dialog-note">
				<Linkified text={message} />
			</p>

			<Field
				label="Verification code"
				icon={KeyRound}
				value={code}
				onChange={(e) => setCode(e.target.value)}
				required
				autoFocus
				autoComplete="one-time-code"
			/>

			<DialogActions label="Verify account" icon={ShieldCheck} />
		</form>
	);
}
