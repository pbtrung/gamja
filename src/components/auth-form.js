import { html, Component } from "../lib/index.js";

export default class NetworkForm extends Component {
	state = {
		username: "",
		password: "",
	};

	constructor(props) {
		super(props);

		this.handleInput = this.handleInput.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);

		if (props.username) {
			this.state.username = props.username;
		}
	}

	handleInput(event) {
		let target = event.target;
		let value = target.type === "checkbox" ? target.checked : target.value;
		this.setState({ [target.name]: value });
	}

	handleSubmit(event) {
		event.preventDefault();

		this.props.onSubmit(this.state.username, this.state.password);
	}

	render() {
		return html`
			<form onInput=${this.handleInput} onSubmit=${this.handleSubmit}>
				<div class="mb-3">
					<label class="form-label" for="auth-username">Username</label>
					<input
						type="username"
						class="form-control"
						id="auth-username"
						name="username"
						value=${this.state.username}
						required
					/>
				</div>

				<div class="mb-3">
					<label class="form-label" for="auth-password">Password</label>
					<input
						type="password"
						class="form-control"
						id="auth-password"
						name="password"
						value=${this.state.password}
						required
						autofocus
					/>
				</div>

				<div class="dialog-actions">
					<button class="btn btn-primary">Login</button>
				</div>
			</form>
		`;
	}
}
