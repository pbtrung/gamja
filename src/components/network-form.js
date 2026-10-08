import { html, Component } from "../lib/index.js";
import Icon from "./icon.js";
import { ChevronRight, Trash } from "../icons.js";

const defaultParams = {
	name: "",
	host: "",
	port: 6697,
	nickname: "",
	username: "",
	realname: "",
	pass: "",
};

export default class NetworkForm extends Component {
	prevParams = null;
	state = {
		...defaultParams,
		autojoin: true,
	};

	constructor(props) {
		super(props);

		this.prevParams = { ...defaultParams };

		this.handleInput = this.handleInput.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);

		if (props.params) {
			Object.keys(defaultParams).forEach((k) => {
				if (props.params[k] !== undefined) {
					this.state[k] = props.params[k];
					this.prevParams[k] = props.params[k];
				}
			});
		}
	}

	handleInput(event) {
		let target = event.target;
		let value = target.type === "checkbox" ? target.checked : target.value;
		this.setState({ [target.name]: value });
	}

	handleSubmit(event) {
		event.preventDefault();

		let params = {};
		Object.keys(defaultParams).forEach((k) => {
			if (!this.props.isNew && this.prevParams[k] === this.state[k]) {
				return;
			}
			if (this.props.isNew && defaultParams[k] === this.state[k]) {
				return;
			}
			params[k] = this.state[k];
		});

		let autojoin = this.state.autojoin ? this.props.autojoin : null;
		this.props.onSubmit(params, autojoin);
	}

	render() {
		let removeNetwork = null;
		if (!this.props.isNew) {
			removeNetwork = html`
				<button
					type="button"
					class="btn btn-outline-danger me-auto"
					onClick=${() => this.props.onRemove()}
				>
					<${Icon} icon=${Trash} /> Remove network
				</button>
			`;
		}

		let autojoin = null;
		if (this.props.autojoin) {
			autojoin = html`
				<div class="form-check mb-3">
					<input
						type="checkbox"
						class="form-check-input"
						id="network-autojoin"
						name="autojoin"
						checked=${this.state.autojoin}
					/>
					<label class="form-check-label" for="network-autojoin">
						Auto-join channel <strong>${this.props.autojoin}</strong>
					</label>
				</div>
			`;
		}

		return html`
			<form onInput=${this.handleInput} onSubmit=${this.handleSubmit}>
				<div class="mb-3">
					<label class="form-label" for="network-host">Hostname</label>
					<input
						type="text"
						class="form-control"
						id="network-host"
						name="host"
						value=${this.state.host}
						autofocus
						required
					/>
				</div>

				${autojoin}

				<details class="advanced-options">
					<summary role="button">
						<${Icon} icon=${ChevronRight} class="chevron" /> Advanced options
					</summary>

					<div class="pt-3">
						<div class="mb-3">
							<label class="form-label" for="network-port">Port</label>
							<input
								type="number"
								class="form-control"
								id="network-port"
								name="port"
								value=${this.state.port}
							/>
						</div>
						<div class="mb-3">
							<label class="form-label" for="network-name">Network name</label>
							<input
								type="text"
								class="form-control"
								id="network-name"
								name="name"
								value=${this.state.name}
							/>
						</div>
						<div class="mb-3">
							<label class="form-label" for="network-nickname">Nickname</label>
							<input
								type="username"
								class="form-control"
								id="network-nickname"
								name="nickname"
								value=${this.state.nickname}
							/>
						</div>
						<div class="mb-3">
							<label class="form-label" for="network-username">Username</label>
							<input
								type="username"
								class="form-control"
								id="network-username"
								name="username"
								value=${this.state.username}
							/>
						</div>
						<div class="mb-3">
							<label class="form-label" for="network-realname">Real name</label>
							<input
								type="text"
								class="form-control"
								id="network-realname"
								name="realname"
								value=${this.state.realname}
							/>
						</div>
						<div class="mb-3">
							<label class="form-label" for="network-pass">Server password</label>
							<input
								type="password"
								class="form-control"
								id="network-pass"
								name="pass"
								value=${this.state.pass}
								placeholder="None"
							/>
						</div>
					</div>
				</details>

				<div class="dialog-actions">
					${removeNetwork}
					<button class="btn btn-primary">
						${this.props.isNew ? "Add network" : "Save network"}
					</button>
				</div>
			</form>
		`;
	}
}
