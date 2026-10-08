import { useState, type FormEvent } from "react";
import { ChevronRight, CircleAlert, LogIn, MessageSquareText } from "lucide-react";
import type { ConnectParams } from "../../app/store";
import { Linkified } from "../RichText";

interface ConnectFormProps {
	params: ConnectParams;
	auth?: string | null;
	connecting: boolean;
	error: string | null;
	onSubmit: (params: Partial<ConnectParams>) => void;
}

export default function ConnectForm({ params, auth, connecting, error, onSubmit }: ConnectFormProps) {
	const [form, setForm] = useState({
		url: params.url || "",
		pass: "",
		nick: params.nick || "",
		password: "",
		rememberMe: params.autoconnect || false,
		username: params.username || "",
		realname: params.realname || "",
		autojoin: true,
	});
	const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
		setForm((f) => ({ ...f, [k]: v }));

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		if (connecting) {
			return;
		}

		const result: Partial<ConnectParams> = {
			url: form.url,
			pass: form.pass,
			nick: form.nick,
			autoconnect: form.rememberMe,
			username: form.username,
			realname: form.realname,
			saslPlain: null,
			autojoin: [],
		};

		if (form.password) {
			result.saslPlain = {
				username: form.username || form.nick,
				password: form.password,
			};
		} else if (auth === "external") {
			result.saslExternal = true;
		} else if (auth === "oauth2") {
			result.saslOauthBearer = params.saslOauthBearer;
		}

		if (form.autojoin) {
			result.autojoin = params.autojoin || [];
		}

		onSubmit(result);
	}

	const showPassword = auth !== "disabled" && auth !== "external" && auth !== "oauth2";
	const channels = params.autojoin || [];

	return (
		<form className="card connect-card" onSubmit={handleSubmit} aria-labelledby="connect-title">
			<div className="connect-header">
				<div className="connect-logo" aria-hidden="true">
					<MessageSquareText />
				</div>
				<h1 id="connect-title">Connect to IRC</h1>
				<p className="muted">Pick a nickname to get started</p>
			</div>

			<div className="field">
				<label htmlFor="connect-nick">Nickname</label>
				<input
					type="text"
					id="connect-nick"
					name="nick"
					autoComplete="username"
					value={form.nick}
					disabled={connecting}
					onChange={(e) => set("nick", e.target.value)}
					required
					autoFocus
				/>
			</div>

			{showPassword && (
				<div className="field">
					<label htmlFor="connect-password">Password</label>
					<input
						type="password"
						id="connect-password"
						name="password"
						autoComplete="current-password"
						value={form.password}
						disabled={connecting}
						required={auth === "mandatory"}
						placeholder={auth !== "mandatory" ? "(optional)" : undefined}
						onChange={(e) => set("password", e.target.value)}
					/>
				</div>
			)}

			{channels.length > 0 && (
				<label className="check">
					<input
						type="checkbox"
						name="autojoin"
						checked={form.autojoin}
						onChange={(e) => set("autojoin", e.target.checked)}
					/>
					<span>
						Auto-join channel{channels.length > 1 ? "s" : ""}{" "}
						<strong>{channels.join(", ")}</strong>
					</span>
				</label>
			)}

			<label className="check">
				<input
					type="checkbox"
					name="rememberMe"
					checked={form.rememberMe}
					disabled={connecting}
					onChange={(e) => set("rememberMe", e.target.checked)}
				/>
				<span>Remember me</span>
			</label>

			<details className="advanced-options">
				<summary>
					<ChevronRight className="chevron" aria-hidden="true" /> Advanced options
				</summary>

				<div className="advanced-body">
					{!params.url && (
						<div className="field">
							<label htmlFor="connect-url">Server URL</label>
							<input
								type="text"
								id="connect-url"
								name="url"
								value={form.url}
								disabled={connecting}
								inputMode="url"
								placeholder="wss://irc.example.org"
								onChange={(e) => set("url", e.target.value)}
							/>
						</div>
					)}

					<div className="field">
						<label htmlFor="connect-username">Username</label>
						<input
							type="text"
							id="connect-username"
							name="username"
							value={form.username}
							disabled={connecting}
							placeholder="Same as nickname"
							onChange={(e) => set("username", e.target.value)}
						/>
					</div>

					<div className="field">
						<label htmlFor="connect-realname">Real name</label>
						<input
							type="text"
							id="connect-realname"
							name="realname"
							value={form.realname}
							disabled={connecting}
							placeholder="Same as nickname"
							onChange={(e) => set("realname", e.target.value)}
						/>
					</div>

					<div className="field">
						<label htmlFor="connect-pass">Server password</label>
						<input
							type="password"
							id="connect-pass"
							name="pass"
							value={form.pass}
							disabled={connecting}
							placeholder="None"
							onChange={(e) => set("pass", e.target.value)}
						/>
					</div>
				</div>
			</details>

			<button type="submit" className="btn btn-primary btn-block" disabled={connecting}>
				{connecting ? (
					<>
						<span className="spinner" aria-hidden="true" />
						<span role="status">Connecting…</span>
					</>
				) : (
					<>
						<LogIn aria-hidden="true" /> Connect
					</>
				)}
			</button>

			{!connecting && error && (
				<div className="alert alert-danger" role="alert">
					<CircleAlert aria-hidden="true" />
					<div>
						<Linkified text={error} />
					</div>
				</div>
			)}
		</form>
	);
}
