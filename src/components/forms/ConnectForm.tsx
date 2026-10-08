import { useState, type FormEvent } from "react";
import {
	ChevronRight,
	CircleAlert,
	Eye,
	EyeOff,
	History,
	KeyRound,
	LogIn,
	MessageSquareText,
	Palette,
	Server,
	ServerCog,
	User,
} from "lucide-react";
import type { ConnectParams } from "../../app/store";
import { resolveServerURL } from "../../app/config";
import { Linkified } from "../RichText";

interface ConnectFormProps {
	params: ConnectParams;
	auth?: string | null;
	connecting: boolean;
	error: string | null;
	onSubmit: (params: Partial<ConnectParams>) => void;
}

/** Host of the IRC server gamja will connect to, null if unknown */
function serverHost(url: string): string | null {
	try {
		return new URL(resolveServerURL(url || null, window.location)).host || null;
	} catch (_err) {
		return null;
	}
}

const highlights = [
	{ icon: ServerCog, text: "Works best with the soju bouncer" },
	{ icon: History, text: "Chat history, read markers and search" },
	{ icon: Palette, text: "Light, dark and colorful themes" },
];

/** Decorative chat preview painted with the current theme's colors */
function ChatPreview() {
	const lines: [number, string, string][] = [
		[3, "alice", "hey, welcome to gamja!"],
		[9, "bob", "history is loaded from the bouncer"],
		[13, "carol", "and it follows your theme ✨"],
	];
	return (
		<div className="connect-preview" aria-hidden="true">
			{lines.map(([color, nick, text]) => (
				<div className="connect-preview-line" key={nick}>
					<span className={`connect-preview-avatar nick-${color}`}>{nick.charAt(0)}</span>
					<span>
						<span className={`connect-preview-nick nick-${color}`}>{nick}</span>
						<span className="connect-preview-text">{text}</span>
					</span>
				</div>
			))}
		</div>
	);
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
	const [showPassword, setShowPassword] = useState(false);
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

	const askPassword = auth !== "disabled" && auth !== "external" && auth !== "oauth2";
	const channels = params.autojoin || [];
	const host = serverHost(form.url || params.url || "");

	return (
		<div className="connect-shell">
			<aside className="connect-brand">
				<div className="connect-wordmark">
					<span className="connect-logo" aria-hidden="true">
						<MessageSquareText />
					</span>
					gamja
				</div>
				<p className="connect-tagline">A modern IRC client for the web.</p>
				<ChatPreview />
				<ul className="connect-highlights">
					{highlights.map(({ icon: Icon, text }) => (
						<li key={text}>
							<Icon aria-hidden="true" />
							{text}
						</li>
					))}
				</ul>
			</aside>

			<form className="connect-card" onSubmit={handleSubmit} aria-labelledby="connect-title">
				<div className="connect-header">
					<h1 id="connect-title">Connect to IRC</h1>
					<p className="muted">Pick a nickname to get started</p>
					{host && (
						<p className="connect-server">
							<Server aria-hidden="true" />
							<span>
								<span className="visually-hidden">Server: </span>
								{host}
							</span>
						</p>
					)}
				</div>

				<div className="field">
					<label htmlFor="connect-nick">Nickname</label>
					<div className="input-with-icon">
						<User aria-hidden="true" />
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
				</div>

				{askPassword && (
					<div className="field">
						<label htmlFor="connect-password">Password</label>
						<div className="input-with-icon">
							<KeyRound aria-hidden="true" />
							<input
								type={showPassword ? "text" : "password"}
								id="connect-password"
								name="password"
								autoComplete="current-password"
								value={form.password}
								disabled={connecting}
								required={auth === "mandatory"}
								placeholder={auth !== "mandatory" ? "Optional" : undefined}
								onChange={(e) => set("password", e.target.value)}
							/>
							<button
								type="button"
								className="icon-btn input-action"
								title={showPassword ? "Hide password" : "Show password"}
								aria-label={showPassword ? "Hide password" : "Show password"}
								aria-pressed={showPassword}
								onClick={() => setShowPassword((v) => !v)}
							>
								{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
							</button>
						</div>
					</div>
				)}

				<div className="connect-options">
					{channels.length > 0 && (
						<label className="switch-row">
							<span>
								Auto-join channel{channels.length > 1 ? "s" : ""}{" "}
								<strong>{channels.join(", ")}</strong>
							</span>
							<input
								type="checkbox"
								className="switch"
								name="autojoin"
								checked={form.autojoin}
								onChange={(e) => set("autojoin", e.target.checked)}
							/>
						</label>
					)}

					<label className="switch-row">
						<span>Remember me</span>
						<input
							type="checkbox"
							className="switch"
							name="rememberMe"
							checked={form.rememberMe}
							disabled={connecting}
							onChange={(e) => set("rememberMe", e.target.checked)}
						/>
					</label>
				</div>

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

				<button type="submit" className="btn btn-primary btn-block btn-lg" disabled={connecting}>
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
		</div>
	);
}
