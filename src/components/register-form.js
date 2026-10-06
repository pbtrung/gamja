import { html, Component } from "../lib/index.js";

export default class RegisterForm extends Component {
	state = {
		email: "",
		password: "",
	};

	constructor(props) {
		super(props);

		this.handleInput = this.handleInput.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);
	}

	handleInput(event) {
		let target = event.target;
		let value = target.type === "checkbox" ? target.checked : target.value;
		this.setState({ [target.name]: value });
	}

	handleSubmit(event) {
		event.preventDefault();

		this.props.onSubmit(this.state.email, this.state.password);
	}

	render() {
		return html`
			<form onInput=${this.handleInput} onSubmit=${this.handleSubmit}>
				<div class="mb-3">
					<label class="form-label" for="register-email">E-mail</label>
					<input
						type="email"
						class="form-control"
						id="register-email"
						name="email"
						value=${this.state.email}
						required=${this.props.emailRequired}
						placeholder=${this.props.emailRequired ? null : "(optional)"}
						autofocus
					/>
				</div>

				<div class="mb-3">
					<label class="form-label" for="register-password">Password</label>
					<input type="password" class="form-control" id="register-password" name="password" value=${this.state.password} required/>
				</div>

				<div class="dialog-actions">
					<button class="btn btn-primary">Register</button>
				</div>
			</form>
		`;
	}
}
