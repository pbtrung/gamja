import { html, Component } from "../lib/index.js";
import Icon from "./icon.js";
import { LogOut } from "../icons.js";

export default class SettingsForm extends Component {
	state = {};

	constructor(props) {
		super(props);

		this.state.secondsInTimestamps = props.settings.secondsInTimestamps;
		this.state.bufferEvents = props.settings.bufferEvents;
		this.state.showMemberList = props.settings.showMemberList;

		this.handleInput = this.handleInput.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);
	}

	handleInput(event) {
		let target = event.target;
		let value = target.type === "checkbox" ? target.checked : target.value;
		this.setState({ [target.name]: value }, () => {
			this.props.onChange(this.state);
		});
	}

	handleSubmit(event) {
		event.preventDefault();
		this.props.onClose();
	}

	registerProtocol() {
		let url = window.location.origin + window.location.pathname + "?open=%s";
		try {
			navigator.registerProtocolHandler("irc", url);
			navigator.registerProtocolHandler("ircs", url);
		} catch (err) {
			console.error("Failed to register protocol handler: ", err);
		}
	}

	render() {
		let protocolHandler = null;
		if (this.props.showProtocolHandler) {
			protocolHandler = html`
				<div class="protocol-handler card card-body bg-body-tertiary border-0 mb-3">
					<div class="small">
						Set gamja as your default IRC client for this browser.
						IRC links will be automatically opened here.
					</div>
					<button type="button" class="btn btn-sm btn-outline-primary flex-shrink-0" onClick=${() => this.registerProtocol()}>
						Enable
					</button>
				</div>
			`;
		}

		return html`
			<form onInput=${this.handleInput} onSubmit=${this.handleSubmit}>
				<h3 class="settings-heading">Display</h3>
				<div class="form-check mb-3">
					<input
						type="checkbox"
						class="form-check-input"
						id="settings-seconds"
						name="secondsInTimestamps"
						checked=${this.state.secondsInTimestamps}
					/>
					<label class="form-check-label" for="settings-seconds">Show seconds in time indicator</label>
				</div>
				<div class="form-check mb-3">
					<input
						type="checkbox"
						class="form-check-input"
						id="settings-member-list"
						name="showMemberList"
						checked=${this.state.showMemberList}
					/>
					<label class="form-check-label" for="settings-member-list">Show member list</label>
				</div>

				<fieldset class="mb-3">
					<legend class="settings-heading">Chat events</legend>
					<div class="form-check">
						<input
							type="radio"
							class="form-check-input"
							id="settings-events-fold"
							name="bufferEvents"
							value="fold"
							checked=${this.state.bufferEvents === "fold"}
						/>
						<label class="form-check-label" for="settings-events-fold">Show and fold chat events</label>
					</div>
					<div class="form-check">
						<input
							type="radio"
							class="form-check-input"
							id="settings-events-expand"
							name="bufferEvents"
							value="expand"
							checked=${this.state.bufferEvents === "expand"}
						/>
						<label class="form-check-label" for="settings-events-expand">Show and expand chat events</label>
					</div>
					<div class="form-check">
						<input
							type="radio"
							class="form-check-input"
							id="settings-events-hide"
							name="bufferEvents"
							value="hide"
							checked=${this.state.bufferEvents === "hide"}
						/>
						<label class="form-check-label" for="settings-events-hide">Hide chat events</label>
					</div>
				</fieldset>

				${protocolHandler}

				<div class="dialog-actions">
					<button type="button" class="btn btn-outline-danger me-auto" onClick=${() => this.props.onDisconnect()}>
						<${Icon} icon=${LogOut}/> Disconnect
					</button>
					<button class="btn btn-primary">
						Close
					</button>
				</div>
			</form>
		`;
	}
}
