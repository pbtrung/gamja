import { html, Component } from "../lib/index.js";

export default class ConfirmOpenBuffer extends Component {
	constructor(props) {
		super(props);
		this.handleSubmit = this.handleSubmit.bind(this);
	}

	handleSubmit(event) {
		event.preventDefault();
		this.props.onSubmit();
	}

	render() {
		const isChannel = this.props.client.isChannel(this.props.name);
		const kind = isChannel ? "channel" : "user";
		return html`
			<form onSubmit=${this.handleSubmit}>
				<p>Do you want to open a new buffer for ${kind} <strong>${this.props.name}</strong>?</p>
				<button>Open</button>
			</form>
		`;
	}
}
