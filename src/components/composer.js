import { html, Component, createRef } from "../lib/index.js";
import Icon from "./icon.js";
import { Paperclip, SendHorizontal, X } from "../icons.js";

function encodeContentDisposition(filename) {
	// Encode filename according to RFC 5987 if necessary. Note,
	// encodeURIComponent will percent-encode a superset of attr-char.
	let encodedFilename = encodeURIComponent(filename);
	if (encodedFilename === filename) {
		return 'attachment; filename="' + filename + '"';
	} else {
		return "attachment; filename*=UTF-8''" + encodedFilename;
	}
}

export default class Composer extends Component {
	state = {
		text: "",
		uploading: false,
		dragging: false,
	};
	form = createRef();
	textInput = createRef();
	fileInput = createRef();
	lastAutocomplete = null;
	uploadCount = 0;
	uploadAbortController = null;

	constructor(props) {
		super(props);

		this.handleInput = this.handleInput.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);
		this.handleInputKeyDown = this.handleInputKeyDown.bind(this);
		this.handleInputPaste = this.handleInputPaste.bind(this);
		this.handleDragEnter = this.handleDragEnter.bind(this);
		this.handleDragLeave = this.handleDragLeave.bind(this);
		this.handleDragOver = this.handleDragOver.bind(this);
		this.handleDrop = this.handleDrop.bind(this);
		this.handleWindowKeyDown = this.handleWindowKeyDown.bind(this);
		this.handleWindowPaste = this.handleWindowPaste.bind(this);
		this.handleUploadClick = this.handleUploadClick.bind(this);
		this.handleCancelClick = this.handleCancelClick.bind(this);
		this.handleFileInputChange = this.handleFileInputChange.bind(this);
	}

	handleInput(event) {
		this.setState({ [event.target.name]: event.target.value });

		if (this.props.readOnly && event.target.name === "text" && !event.target.value) {
			event.target.blur();
		}
	}

	handleSubmit(event) {
		event.preventDefault();
		this.props.onSubmit(this.state.text);
		this.setState({ text: "" });
	}

	handleInputKeyDown(event) {
		let input = event.target;

		if (!this.props.autocomplete || event.key !== "Tab") {
			return;
		}

		if (input.selectionStart !== input.selectionEnd) {
			return;
		}

		event.preventDefault();

		let carretPos = input.selectionStart;
		let text = this.state.text;
		let autocomplete;
		if (
			this.lastAutocomplete &&
			this.lastAutocomplete.text === text &&
			this.lastAutocomplete.carretPos === carretPos
		) {
			autocomplete = this.lastAutocomplete;
		} else {
			this.lastAutocomplete = null;

			let wordStart;
			for (wordStart = carretPos - 1; wordStart >= 0; wordStart--) {
				if (text[wordStart] === " ") {
					break;
				}
			}
			wordStart++;

			let wordEnd;
			for (wordEnd = carretPos; wordEnd < text.length; wordEnd++) {
				if (text[wordEnd] === " ") {
					break;
				}
			}

			let word = text.slice(wordStart, wordEnd);
			if (!word) {
				return;
			}

			let replacements = this.props.autocomplete(word);
			if (replacements.length === 0) {
				return;
			}

			autocomplete = {
				text,
				carretPos: input.selectionStart,
				prefix: text.slice(0, wordStart),
				suffix: text.slice(wordEnd),
				replacements,
				replIndex: -1,
			};
		}

		let n = autocomplete.replacements.length;
		if (event.shiftKey) {
			autocomplete.replIndex--;
		} else {
			autocomplete.replIndex++;
		}
		autocomplete.replIndex = (autocomplete.replIndex + n) % n;

		let repl = autocomplete.replacements[autocomplete.replIndex];
		if (!autocomplete.prefix && !autocomplete.suffix) {
			if (repl.startsWith("/")) {
				repl += " ";
			} else {
				repl += ": ";
			}
		}

		autocomplete.text = autocomplete.prefix + repl + autocomplete.suffix;
		autocomplete.carretPos = autocomplete.prefix.length + repl.length;

		input.value = autocomplete.text;
		input.selectionStart = autocomplete.carretPos;
		input.selectionEnd = input.selectionStart;

		this.lastAutocomplete = autocomplete;

		this.setState({ text: autocomplete.text });
	}

	canUploadFiles() {
		let client = this.props.client;
		return client && client.isupport.filehost() && !this.props.readOnly;
	}

	async uploadFile(file, signal) {
		let client = this.props.client;
		let endpoint = client.isupport.filehost();

		let auth;
		if (client.params.saslPlain) {
			let params = client.params.saslPlain;
			auth = "Basic " + btoa(params.username + ":" + params.password);
		} else if (client.params.saslOauthBearer) {
			auth = "Bearer " + client.params.saslOauthBearer.token;
		}

		let headers = {
			"Content-Length": file.size,
			"Content-Disposition": encodeContentDisposition(file.name),
		};
		if (file.type) {
			headers["Content-Type"] = file.type;
		}
		if (auth) {
			headers["Authorization"] = auth;
		}

		let resp = await fetch(endpoint, {
			method: "POST",
			body: file,
			headers,
			credentials: "include",
			signal,
		});

		if (!resp.ok) {
			throw new Error(`HTTP request failed (${resp.status})`);
		}

		let loc = resp.headers.get("Location");
		if (!loc) {
			throw new Error("filehost response missing Location header field");
		}

		return new URL(loc, endpoint);
	}

	async uploadFileList(fileList) {
		if (!this.uploadAbortController) {
			this.uploadAbortController = new AbortController();
		}
		let signal = this.uploadAbortController.signal;
		this.uploadCount++;
		this.setState({ uploading: true });

		let promises = [];
		for (let file of fileList) {
			promises.push(this.uploadFile(file, signal));
		}

		let urls;
		try {
			urls = await Promise.all(promises);
		} catch (err) {
			if (!signal.aborted) {
				this.props.onError(new Error("Failed to upload files", { cause: err }));
			}
			return;
		} finally {
			this.uploadCount--;
			if (this.uploadCount === 0) {
				this.uploadAbortController = null;
				this.setState({ uploading: false });
			}
		}

		this.setState((state) => {
			if (state.text) {
				return { text: state.text + " " + urls.join(" ") };
			} else {
				return { text: urls.join(" ") };
			}
		});
	}

	async handleInputPaste(event) {
		if (event.clipboardData.files.length === 0 || !this.canUploadFiles()) {
			return;
		}

		event.preventDefault();
		event.stopImmediatePropagation();

		await this.uploadFileList(event.clipboardData.files);
	}

	isDraggingFiles(event) {
		return Array.from(event.dataTransfer.items).every((item) => item.kind === "file");
	}

	handleDragEnter(event) {
		if (!this.canUploadFiles() || !this.isDraggingFiles(event)) {
			return;
		}
		this.setState({ dragging: true });
	}

	handleDragLeave(event) {
		// ignore spurious dragleave events triggered by moving over child elements
		if (this.form.current.contains(event.relatedTarget)) {
			return;
		}
		this.setState({ dragging: false });
	}

	handleDragOver(event) {
		if (!this.canUploadFiles() || !this.isDraggingFiles(event)) {
			return;
		}
		event.preventDefault();
	}

	async handleDrop(event) {
		if (event.dataTransfer.files.length === 0 || !this.canUploadFiles()) {
			return;
		}

		event.preventDefault();
		event.stopImmediatePropagation();

		// dragleave does not fire after a drop, so reset manually.
		this.setState({ dragging: false });
		this.textInput.current.focus();
		await this.uploadFileList(event.dataTransfer.files);
	}

	handleUploadClick(event) {
		event.preventDefault();
		this.textInput.current.focus();
		this.fileInput.current.click();
	}

	handleCancelClick(event) {
		event.preventDefault();
		this.uploadAbortController.abort();
	}

	async handleFileInputChange(event) {
		let files = event.target.files;
		if (files.length === 0) {
			return;
		}
		await this.uploadFileList(files);
		event.target.value = "";
	}

	handleWindowKeyDown(event) {
		// If an <input> or <button> is focused, ignore.
		if (document.activeElement && document.activeElement !== document.body) {
			switch (document.activeElement.tagName.toLowerCase()) {
				case "section":
				case "a":
					break;
				default:
					return;
			}
		}

		// If a modifier is pressed, reserve for key bindings.
		if (event.altKey || event.ctrlKey || event.metaKey) {
			return;
		}

		// Ignore events that don't produce a Unicode string. If the key event
		// result in a character being typed by the user, KeyboardEvent.key
		// will contain the typed string. The key string may contain one
		// Unicode non-control character and multiple Unicode combining
		// characters. String.prototype.length cannot be used since it would
		// return the number of Unicode code-points. Instead, the spread
		// operator is used to count the number of non-combining Unicode
		// characters.
		if ([...event.key].length !== 1) {
			return;
		}

		if (this.state.text) {
			return;
		}

		if (this.props.readOnly || (this.props.commandOnly && event.key !== "/")) {
			return;
		}

		event.preventDefault();
		this.setState({ text: event.key }, () => {
			this.focus();
		});
	}

	handleWindowPaste(event) {
		// If an <input> is focused, ignore.
		if (document.activeElement !== document.body && document.activeElement.tagName !== "SECTION") {
			return;
		}

		if (this.props.readOnly) {
			return;
		}

		if (!this.textInput.current) {
			return;
		}

		if (event.clipboardData.files.length > 0) {
			this.handleInputPaste(event);
			return;
		}

		let text = event.clipboardData.getData("text");

		event.preventDefault();
		event.stopImmediatePropagation();

		this.textInput.current.focus();
		this.textInput.current.setRangeText(text, undefined, undefined, "end");
		this.setState({ text: this.textInput.current.value });
	}

	componentDidMount() {
		window.addEventListener("keydown", this.handleWindowKeyDown);
		window.addEventListener("paste", this.handleWindowPaste);
	}

	componentWillUnmount() {
		window.removeEventListener("keydown", this.handleWindowKeyDown);
		window.removeEventListener("paste", this.handleWindowPaste);
	}

	focus() {
		if (!this.textInput.current) {
			return;
		}
		document.activeElement.blur(); // in case we're read-only
		this.textInput.current.focus();
	}

	render() {
		let classes = [];
		if (this.props.readOnly && !this.state.text) {
			classes.push("read-only");
		}
		if (this.state.uploading) {
			classes.push("uploading");
		}
		if (this.state.dragging) {
			classes.push("dragging");
		}
		let className = classes.join(" ");

		let placeholder = "Type a message";
		if (this.props.commandOnly) {
			placeholder = "Type a command (see /help)";
		}

		let uploadButtons = null;
		let fileInput = null;
		if (this.canUploadFiles()) {
			uploadButtons = html`
				${
					this.state.uploading &&
					html`
						<button
							type="button"
							id="composer-spinner"
							title="Cancel upload"
							aria-label="Cancel upload"
							onClick=${this.handleCancelClick}
						>
							<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
							<${Icon} icon=${X} class="x-icon" />
						</button>
					`
				}
				<button
					type="button"
					id="composer-upload"
					title="Upload file"
					aria-label="Upload file"
					onClick=${this.handleUploadClick}
				>
					<${Icon} icon=${Paperclip} />
				</button>
			`;
			fileInput = html`
				<input
					type="file"
					ref=${this.fileInput}
					multiple
					hidden
					onChange=${this.handleFileInputChange}
				/>
			`;
		}

		return html`
			<form
				id="composer"
				class=${className}
				ref=${this.form}
				onInput=${this.handleInput}
				onSubmit=${this.handleSubmit}
				onDragEnter=${this.handleDragEnter}
				onDragLeave=${this.handleDragLeave}
				onDragOver=${this.handleDragOver}
				onDrop=${this.handleDrop}
			>
				<div class="composer-box">
					<input
						type="text"
						name="text"
						class="composer-input"
						ref=${this.textInput}
						value=${this.state.text}
						autocomplete="off"
						placeholder=${placeholder}
						aria-label=${placeholder}
						enterkeyhint="send"
						onKeyDown=${this.handleInputKeyDown}
						onPaste=${this.handleInputPaste}
						maxlength=${this.props.maxLen}
					/>
					<div id="composer-buttons">
						${uploadButtons}
						<button type="submit" id="composer-send" title="Send" aria-label="Send">
							<${Icon} icon=${SendHorizontal} />
						</button>
					</div>
				</div>
				${fileInput}
			</form>
		`;
	}
}
