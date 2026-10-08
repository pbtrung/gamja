import { html } from "../lib/index.js";
import { keybindings } from "../keybindings.js";
import commands from "../commands.js";
import Icon from "./icon.js";
import { Info, Keyboard, Terminal } from "../icons.js";

function KeyBindingsHelp() {
	let l = keybindings.map((binding) => {
		let keys = [];
		if (binding.ctrlKey) {
			keys.push("Ctrl");
		}
		if (binding.altKey) {
			keys.push("Alt");
		}
		keys.push(binding.key);

		keys = keys.map((name, i) => {
			return html`
				${i > 0 ? "+" : null}
				<kbd>${name}</kbd>
			`;
		});

		return html`
			<dt class="col-sm-5">${keys}</dt>
			<dd class="col-sm-7">${binding.description}</dd>
		`;
	});

	l.push(html`
		<dt class="col-sm-5"><kbd>Tab</kbd></dt>
		<dd class="col-sm-7">Automatically complete nickname or channel</dd>
	`);

	if (!window.matchMedia("(pointer: none)").matches) {
		l.push(html`
			<dt class="col-sm-5">Middle mouse click</dt>
			<dd class="col-sm-7">Close buffer</dd>
		`);
	}

	return html`<dl class="row help-list">${l}</dl>`;
}

function CommandsHelp() {
	let l = [...commands.keys()].map((name) => {
		let cmd = commands.get(name);

		let usage = [html`<strong>/${name}</strong>`];
		if (cmd.usage) {
			usage.push(" " + cmd.usage);
		}

		return html`
			<dt><code>${usage}</code></dt>
			<dd class="text-body-secondary">${cmd.description}</dd>
		`;
	});

	return html`<dl class="help-list">${l}</dl>`;
}

export default function Help() {
	return html`
		<h3 class="settings-heading"><${Icon} icon=${Info} /> About</h3>
		<p>
			<strong>gamja</strong> is licensed under
			<a href="https://www.gnu.org/licenses/agpl-3.0.en.html" target="_blank" rel="noreferrer">AGPLv3</a
			>. Source code is available
			<a href="https://codeberg.org/emersion/gamja" target="_blank" rel="noreferrer">on Codeberg</a>.
		</p>

		<h3 class="settings-heading"><${Icon} icon=${Keyboard} /> Key bindings</h3>
		<${KeyBindingsHelp} />

		<h3 class="settings-heading"><${Icon} icon=${Terminal} /> Commands</h3>
		<${CommandsHelp} />
	`;
}
