import { html, Component, createRef } from "../lib/index.js";

export default class Dialog extends Component {
	body = createRef();

	constructor(props) {
		super(props);

		this.handleCloseClick = this.handleCloseClick.bind(this);
		this.handleBackdropClick = this.handleBackdropClick.bind(this);
		this.handleKeyDown = this.handleKeyDown.bind(this);
	}

	dismiss() {
		this.props.onDismiss();
	}

	handleCloseClick(event) {
		event.preventDefault();
		this.dismiss();
	}

	handleBackdropClick(event) {
		if (event.target === event.currentTarget) {
			this.dismiss();
		}
	}

	handleKeyDown(event) {
		if (event.key === "Escape") {
			this.dismiss();
		}
	}

	componentDidMount() {
		window.addEventListener("keydown", this.handleKeyDown);

		let autofocus = this.body.current.querySelector("input[autofocus]");
		if (autofocus) {
			autofocus.focus();
		}
	}

	componentWillUnmount() {
		window.removeEventListener("keydown", this.handleKeyDown);
	}

	render() {
		return html`
			<div class="modal-backdrop show"></div>
			<div
				class="modal d-block"
				tabindex="-1"
				onClick=${this.handleBackdropClick}
				role="dialog"
				aria-modal="true"
				aria-labelledby="dialog-title"
			>
				<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
					<div class="modal-content shadow-lg" ref=${this.body}>
						<div class="modal-header">
							<h2 class="modal-title fs-5" id="dialog-title">${this.props.title}</h2>
							<button
								type="button"
								class="btn-close"
								onClick=${this.handleCloseClick}
								title="Close"
								aria-label="Close"
							></button>
						</div>
						<div class="modal-body">
							${this.props.children}
						</div>
					</div>
				</div>
			</div>
		`;
	}
}
