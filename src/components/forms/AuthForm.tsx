import { useState, type FormEvent } from "react";

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
				<input
					type="text"
					id="auth-username"
					autoComplete="username"
					value={username}
					onChange={(e) => setUsername(e.target.value)}
					required
				/>
			</div>

			<div className="field">
				<label htmlFor="auth-password">Password</label>
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

			<div className="dialog-actions">
				<button type="submit" className="btn btn-primary">
					Login
				</button>
			</div>
		</form>
	);
}
