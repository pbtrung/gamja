import { useState, type FormEvent } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Linkified } from "../RichText";

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
			<p>
				Your account <strong>{account}</strong> has been created, but a verification code is required
				to complete the registration.
			</p>

			<p className="dialog-note">
				<Linkified text={message} />
			</p>

			<div className="field">
				<label htmlFor="verify-code">Verification code</label>
				<div className="input-with-icon">
					<KeyRound aria-hidden="true" />
					<input
						type="text"
						id="verify-code"
						value={code}
						onChange={(e) => setCode(e.target.value)}
						required
						autoFocus
						autoComplete="one-time-code"
					/>
				</div>
			</div>

			<div className="dialog-actions">
				<button type="submit" className="btn btn-primary">
					<ShieldCheck aria-hidden="true" /> Verify account
				</button>
			</div>
		</form>
	);
}
