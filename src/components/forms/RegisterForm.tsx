import { useState, type FormEvent } from "react";
import { KeyRound, Mail, UserPlus } from "lucide-react";

export default function RegisterForm({
	emailRequired,
	onSubmit,
}: {
	emailRequired: boolean;
	onSubmit: (email: string, password: string) => void;
}) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		onSubmit(email, password);
	}

	return (
		<form onSubmit={handleSubmit}>
			<div className="field">
				<label htmlFor="register-email">E-mail</label>
				<div className="input-with-icon">
					<Mail aria-hidden="true" />
					<input
						type="email"
						id="register-email"
						autoComplete="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required={emailRequired}
						placeholder={emailRequired ? undefined : "Optional"}
						autoFocus
					/>
				</div>
			</div>

			<div className="field">
				<label htmlFor="register-password">Password</label>
				<div className="input-with-icon">
					<KeyRound aria-hidden="true" />
					<input
						type="password"
						id="register-password"
						autoComplete="new-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
					/>
				</div>
			</div>

			<div className="dialog-actions">
				<button type="submit" className="btn btn-primary">
					<UserPlus aria-hidden="true" /> Create account
				</button>
			</div>
		</form>
	);
}
