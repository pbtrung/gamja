import { useState, type FormEvent } from "react";

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
				<input
					type="email"
					id="register-email"
					autoComplete="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					required={emailRequired}
					placeholder={emailRequired ? undefined : "(optional)"}
					autoFocus
				/>
			</div>

			<div className="field">
				<label htmlFor="register-password">Password</label>
				<input
					type="password"
					id="register-password"
					autoComplete="new-password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					required
				/>
			</div>

			<div className="dialog-actions">
				<button type="submit" className="btn btn-primary">
					Register
				</button>
			</div>
		</form>
	);
}
