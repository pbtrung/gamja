import { useState, type FormEvent } from "react";
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

			<p className="muted">
				<Linkified text={message} />
			</p>

			<div className="field">
				<label htmlFor="verify-code">Verification code</label>
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

			<div className="dialog-actions">
				<button type="submit" className="btn btn-primary">
					Verify account
				</button>
			</div>
		</form>
	);
}
