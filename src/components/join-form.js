import { html, Component } from "../lib/index.js";
import Icon from "./icon.js";
import { Hash } from "../icons.js";

export default class JoinForm extends Component {
	state = {
		channel: "#",
	};

	constructor(props) {
		super(props);

		this.handleInput = this.handleInput.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);

		if (props.channel) {
			this.state.channel = props.channel;
		}
	}

	handleInput(event) {
		let target = event.target;
		let value = target.type === "checkbox" ? target.checked : target.value;
		this.setState({ [target.name]: value });
	}

	handleSubmit(event) {
		event.preventDefault();

		let params = {
			channel: this.state.channel,
		};

		this.props.onSubmit(params);
	}

	render() {
		return html`
			<form onInput=${this.handleInput} onSubmit=${this.handleSubmit}>
				<label class="form-label" for="join-channel">Channel</label>
				<div class="input-group">
					<span class="input-group-text"><${Icon} icon=${Hash} /></span>
					<input
						type="text"
						class="form-control"
						id="join-channel"
						name="channel"
						value=${this.state.channel}
						autofocus
						required
					/>
				</div>

				<div class="dialog-actions">
					<button class="btn btn-primary">Join</button>
				</div>
			</form>
		`;
	}
}
