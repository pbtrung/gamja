import { useState, type FormEvent } from "react";
import { KeyRound, Mail, UserPlus } from "lucide-react";
import Field from "./Field";

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
			<Field
				label="E-mail"
				icon={Mail}
				type="email"
				autoComplete="email"
				value={email}
				onChange={(e) => setEmail(e.target.value)}
				required={emailRequired}
				placeholder={emailRequired ? undefined : "Optional"}
				autoFocus
			/>

			<Field
				label="Password"
				icon={KeyRound}
				type="password"
				autoComplete="new-password"
				value={password}
				onChange={(e) => setPassword(e.target.value)}
				required
			/>

			<div className="dialog-actions">
				<button type="submit" className="btn btn-primary">
					<UserPlus aria-hidden="true" /> Create account
				</button>
			</div>
		</form>
	);
}
