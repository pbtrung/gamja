import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Hash, Search, User as UserIcon } from "lucide-react";
import {
	BufferType,
	getBufferURL,
	getServerName,
	type Buffer,
	type BouncerNetwork,
	type Server,
} from "../../state";
import { matchBuffers } from "../../format";

interface SwitcherFormProps {
	buffers: Map<number, Buffer>;
	servers: Map<number, Server>;
	bouncerNetworks: Map<string, BouncerNetwork>;
	onSubmit: (buf: Buffer | undefined) => void;
}

export default function SwitcherForm({ buffers, servers, bouncerNetworks, onSubmit }: SwitcherFormProps) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);

	const suggestions = matchBuffers(buffers, servers, query);

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		onSubmit(suggestions[selected]);
	}

	function move(delta: number) {
		const n = suggestions.length;
		if (n === 0) {
			return;
		}
		setSelected((selected) => (selected + delta + n) % n);
	}

	function handleKeyDown(event: KeyboardEvent) {
		switch (event.key) {
			case "ArrowUp":
				event.preventDefault();
				event.stopPropagation();
				move(-1);
				break;
			case "ArrowDown":
				event.preventDefault();
				event.stopPropagation();
				move(1);
				break;
		}
	}

	return (
		<form onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
			<div className="input-group field">
				<span className="input-addon" aria-hidden="true">
					<Search />
				</span>
				<input
					type="search"
					name="query"
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setSelected(0);
					}}
					placeholder="Filter"
					aria-label="Filter"
					autoComplete="off"
					role="combobox"
					aria-expanded="true"
					aria-controls="switcher-list"
					aria-activedescendant={
						suggestions[selected] ? `switcher-item-${suggestions[selected].id}` : undefined
					}
					autoFocus
				/>
			</div>
			<ul className="switcher-list" id="switcher-list" role="listbox">
				{suggestions.map((buf, i) => {
					const server = servers.get(buf.server)!;
					const bouncerNetwork = server.bouncerNetID
						? (bouncerNetworks.get(server.bouncerNetID) ?? null)
						: null;
					const Icon = buf.type === BufferType.CHANNEL ? Hash : UserIcon;
					return (
						<li
							key={buf.id}
							id={`switcher-item-${buf.id}`}
							role="option"
							aria-selected={selected === i}
							className={selected === i ? "active" : undefined}
							title={getBufferURL(buf, bouncerNetwork)}
							onClick={() => onSubmit(buf)}
							onMouseMove={() => setSelected(i)}
						>
							<Icon aria-hidden="true" />
							<span className="switcher-name">{buf.name}</span>
							<span className="switcher-server">{getServerName(server, bouncerNetwork)}</span>
						</li>
					);
				})}
				{suggestions.length === 0 && <li className="muted switcher-empty">No matching buffers</li>}
			</ul>
		</form>
	);
}
