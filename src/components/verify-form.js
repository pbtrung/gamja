import { html, Component } from "../lib/index.js";
import linkify from "../lib/linkify.js";

export default class RegisterForm extends Component {
	state = {
		code: "",
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

		this.props.onSubmit(this.state.code);
	}

	render() {
		return html`
			<form onInput=${this.handleInput} onSubmit=${this.handleSubmit}>
				<p>Your account <strong>${this.props.account}</strong> has been created, but a verification code is required to complete the registration.</p>

				<p class="text-body-secondary">${linkify(this.props.message)}</p>

				<div class="mb-3">
					<label class="form-label" for="verify-code">Verification code</label>
					<input type="text" class="form-control" id="verify-code" name="code" value=${this.state.code} required autofocus autocomplete="off"/>
				</div>

				<div class="dialog-actions">
					<button class="btn btn-primary">Verify account</button>
				</div>
			</form>
		`;
	}
}
