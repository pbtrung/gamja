import { html, Component } from "../lib/index.js";
import { getServerName } from "../state.js";

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
		let isChannel = this.props.client.isChannel(this.props.name);
		let kind = isChannel ? "channel" : "user";
		let onNetwork = null;
		if (this.props.bouncerNetwork) {
			onNetwork = ` on ${getServerName(this.props.server, this.props.bouncerNetwork)}`;
		}
		return html`
			<form onSubmit=${this.handleSubmit}>
				<p>
					Do you want to open a new buffer for ${kind} <strong>${this.props.name}</strong>${onNetwork}?
				</p>
				<button>Open</button>
			</form>
		`;
	}
}
