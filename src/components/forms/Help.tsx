import { Info, Keyboard, Terminal } from "lucide-react";
import { keybindings } from "../../keybindings";
import commands from "../../commands";

function KeyBindingsHelp() {
	const hasPointer =
		typeof window.matchMedia !== "function" || !window.matchMedia("(pointer: none)").matches;
	return (
		<dl className="help-list help-keys">
			{keybindings.map((binding) => {
				const keys: string[] = [];
				if (binding.ctrlKey) {
					keys.push("Ctrl");
				}
				if (binding.altKey) {
					keys.push("Alt");
				}
				keys.push(binding.key);
				return (
					<div key={keys.join("+")}>
						<dt>
							{keys.map((name, i) => (
								<span key={name}>
									{i > 0 ? "+" : null}
									<kbd>{name}</kbd>
								</span>
							))}
						</dt>
						<dd>{binding.description}</dd>
					</div>
				);
			})}
			<div>
				<dt>
					<kbd>Tab</kbd>
				</dt>
				<dd>Automatically complete nickname or channel</dd>
			</div>
			{hasPointer && (
				<div>
					<dt>Middle mouse click</dt>
					<dd>Close buffer</dd>
				</div>
			)}
		</dl>
	);
}

function CommandsHelp() {
	return (
		<dl className="help-list help-commands">
			{[...commands.values()].map((cmd) => (
				<div key={cmd.name}>
					<dt>
						<code>
							<strong>/{cmd.name}</strong>
							{cmd.usage ? " " + cmd.usage : null}
						</code>
					</dt>
					<dd className="muted">{cmd.description}</dd>
				</div>
			))}
		</dl>
	);
}

export default function Help() {
	return (
		<>
			<h3 className="settings-heading">
				<Info aria-hidden="true" /> About
			</h3>
			<p>
				<strong>gamja</strong> is licensed under{" "}
				<a href="https://www.gnu.org/licenses/agpl-3.0.en.html" target="_blank" rel="noreferrer">
					AGPLv3
				</a>
				. Source code is available{" "}
				<a href="https://github.com/pbtrung/gamja" target="_blank" rel="noreferrer">
					on GitHub
				</a>
				.
			</p>

			<h3 className="settings-heading">
				<Keyboard aria-hidden="true" /> Key bindings
			</h3>
			<KeyBindingsHelp />

			<h3 className="settings-heading">
				<Terminal aria-hidden="true" /> Commands
			</h3>
			<CommandsHelp />
		</>
	);
}
