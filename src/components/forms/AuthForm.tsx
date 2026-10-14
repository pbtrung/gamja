import { useState, type FormEvent } from "react";
import { KeyRound, LogIn, User } from "lucide-react";
import DialogActions from "./DialogActions";
import Field from "./Field";

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
			<Field
				label="Username"
				icon={User}
				autoComplete="username"
				value={username}
				onChange={(e) => setUsername(e.target.value)}
				required
			/>

			<Field
				label="Password"
				icon={KeyRound}
				type="password"
				autoComplete="current-password"
				value={password}
				onChange={(e) => setPassword(e.target.value)}
				required
				autoFocus
			/>

			<DialogActions label="Log in" icon={LogIn} />
		</form>
	);
}
