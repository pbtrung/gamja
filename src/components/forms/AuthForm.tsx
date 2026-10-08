import { useState, type FormEvent } from "react";
import { KeyRound, LogIn, User } from "lucide-react";

export default function AuthForm({
	username: initialUsername,
	onSubmit,
}: {
	username?: string;
	onSubmit: (username: string, password: string) => void;
}) {
	const [username, setUsername] = useState(initialUsername || "");
	const [password, setPassword] = useState("");

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		onSubmit(username, password);
	}

	return (
		<form onSubmit={handleSubmit}>
			<div className="field">
				<label htmlFor="auth-username">Username</label>
				<div className="input-with-icon">
					<User aria-hidden="true" />
					<input
						type="text"
						id="auth-username"
						autoComplete="username"
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						required
					/>
				</div>
			</div>

			<div className="field">
				<label htmlFor="auth-password">Password</label>
				<div className="input-with-icon">
					<KeyRound aria-hidden="true" />
					<input
						type="password"
						id="auth-password"
						autoComplete="current-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						autoFocus
					/>
				</div>
			</div>

			<div className="dialog-actions">
				<button type="submit" className="btn btn-primary">
					<LogIn aria-hidden="true" /> Log in
				</button>
			</div>
		</form>
	);
}
