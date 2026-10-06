import { html, Component, createRef } from "../lib/index.js";
import linkify from "../lib/linkify.js";
import Icon from "./icon.js";
import { ChevronRight, CircleAlert, LogIn, MessageSquareText } from "../icons.js";

export default class ConnectForm extends Component {
	state = {
		url: "",
		pass: "",
		nick: "",
		password: "",
		rememberMe: false,
		username: "",
		realname: "",
		autojoin: true,
	};
	nickInput = createRef();

	constructor(props) {
		super(props);

		this.handleInput = this.handleInput.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);

		if (props.params) {
			this.state = {
				...this.state,
				url: props.params.url || "",
				nick: props.params.nick || "",
				rememberMe: props.params.autoconnect || false,
				username: props.params.username || "",
				realname: props.params.realname || "",
			};
		}
	}

	handleInput(event) {
		let target = event.target;
		let value = target.type === "checkbox" ? target.checked : target.value;
		this.setState({ [target.name]: value });
	}

	handleSubmit(event) {
		event.preventDefault();

		if (this.props.connecting) {
			return;
		}

		let params = {
			url: this.state.url,
			pass: this.state.pass,
			nick: this.state.nick,
			autoconnect: this.state.rememberMe,
			username: this.state.username,
			realname: this.state.realname,
			saslPlain: null,
			autojoin: [],
		};

		if (this.state.password) {
			params.saslPlain = {
				username: params.username || params.nick,
				password: this.state.password,
			};
		} else if (this.props.auth === "external") {
			params.saslExternal = true;
		} else if (this.props.auth === "oauth2") {
			params.saslOauthBearer = this.props.params.saslOauthBearer;
		}

		if (this.state.autojoin) {
			params.autojoin = this.props.params.autojoin || [];
		}

		this.props.onSubmit(params);
	}

	componentDidMount() {
		if (this.nickInput.current) {
			this.nickInput.current.focus();
		}
	}

	render() {
		let disabled = this.props.connecting;

		let serverURL = null;
		if (!this.props.params || !this.props.params.url) {
			serverURL = html`
				<div class="mb-3">
					<label class="form-label" for="connect-url">Server URL</label>
					<input
						type="text"
						class="form-control"
						id="connect-url"
						name="url"
						value=${this.state.url}
						disabled=${disabled}
						inputmode="url"
					/>
				</div>
			`;
		}

		let status = null;
		if (!this.props.connecting && this.props.error) {
			status = html`
				<div class="alert alert-danger d-flex gap-2 mt-3 mb-0" role="alert">
					<${Icon} icon=${CircleAlert} class="flex-shrink-0 mt-1"/>
					<div class="text-break">${linkify(this.props.error)}</div>
				</div>
			`;
		}

		let auth = null;
		if (this.props.auth !== "disabled" && this.props.auth !== "external" && this.props.auth !== "oauth2") {
			auth = html`
				<div class="mb-3">
					<label class="form-label" for="connect-password">Password</label>
					<input
						type="password"
						class="form-control"
						id="connect-password"
						name="password"
						value=${this.state.password}
						disabled=${disabled}
						required=${this.props.auth === "mandatory"}
						placeholder=${this.props.auth !== "mandatory" ? "(optional)" : ""}
					/>
				</div>
			`;
		}

		let autojoin = null;
		let channels = this.props.params.autojoin || [];
		if (channels.length > 0) {
			let s = channels.length > 1 ? "s" : "";
			autojoin = html`
				<div class="form-check mb-2">
					<input
						type="checkbox"
						class="form-check-input"
						id="connect-autojoin"
						name="autojoin"
						checked=${this.state.autojoin}
					/>
					<label class="form-check-label" for="connect-autojoin">
						Auto-join channel${s} <strong>${channels.join(", ")}</strong>
					</label>
				</div>
			`;
		}

		let submitLabel = html`<${Icon} icon=${LogIn}/> Connect`;
		if (this.props.connecting) {
			submitLabel = html`
				<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
				<span role="status">Connecting…</span>
			`;
		}

		return html`
			<form class="card connect-card shadow-sm" onInput=${this.handleInput} onSubmit=${this.handleSubmit}>
				<div class="card-body p-4">
					<div class="text-center mb-4">
						<div class="connect-logo mb-3">
							<${Icon} icon=${MessageSquareText} size="2rem"/>
						</div>
						<h1 class="h4 mb-1">Connect to IRC</h1>
						<p class="text-body-secondary small mb-0">Pick a nickname to get started</p>
					</div>

					<div class="mb-3">
						<label class="form-label" for="connect-nick">Nickname</label>
						<input
							type="username"
							class="form-control"
							id="connect-nick"
							name="nick"
							value=${this.state.nick}
							disabled=${disabled}
							ref=${this.nickInput}
							required
							autofocus
						/>
					</div>

					${auth}

					${autojoin}

					<div class="form-check mb-3">
						<input
							type="checkbox"
							class="form-check-input"
							id="connect-remember"
							name="rememberMe"
							checked=${this.state.rememberMe}
							disabled=${disabled}
						/>
						<label class="form-check-label" for="connect-remember">Remember me</label>
					</div>

					<details class="advanced-options mb-3">
						<summary role="button">
							<${Icon} icon=${ChevronRight} class="chevron"/> Advanced options
						</summary>

						<div class="pt-3">
							${serverURL}

							<div class="mb-3">
								<label class="form-label" for="connect-username">Username</label>
								<input
									type="username"
									class="form-control"
									id="connect-username"
									name="username"
									value=${this.state.username}
									disabled=${disabled}
									placeholder="Same as nickname"
								/>
							</div>

							<div class="mb-3">
								<label class="form-label" for="connect-realname">Real name</label>
								<input
									type="text"
									class="form-control"
									id="connect-realname"
									name="realname"
									value=${this.state.realname}
									disabled=${disabled}
									placeholder="Same as nickname"
								/>
							</div>

							<div>
								<label class="form-label" for="connect-pass">Server password</label>
								<input
									type="password"
									class="form-control"
									id="connect-pass"
									name="pass"
									value=${this.state.pass}
									disabled=${disabled}
									placeholder="None"
								/>
							</div>
						</div>
					</details>

					<button class="btn btn-primary w-100 d-inline-flex align-items-center justify-content-center gap-2" disabled=${disabled}>
						${submitLabel}
					</button>

					${status}
				</div>
			</form>
		`;
	}
}
