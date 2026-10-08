import * as irc from "../lib/irc";
import { strip as stripANSI } from "../lib/ansi";
import { html } from "../lib/index.js";
import Icon from "./icon.js";
import { MessagesSquare, Server, User } from "../icons.js";
import { BufferType, Unread, ServerStatus, getBufferURL, getServerName } from "../state.js";

function BufferItem(props) {
	function handleClick(event) {
		event.preventDefault();
		props.onClick();
	}
	function handleMouseDown(event) {
		if (event.button === 1) {
			// middle click
			event.preventDefault();
			props.onClose();
		}
	}

	let name = props.buffer.name;
	if (props.buffer.type === BufferType.SERVER) {
		name = getServerName(props.server, props.bouncerNetwork);
	}

	let title;
	let classes = ["type-" + props.buffer.type];
	if (props.active) {
		classes.push("active");
	}
	if (props.buffer.unread !== Unread.NONE) {
		classes.push("unread-" + props.buffer.unread);
	}
	switch (props.buffer.type) {
		case BufferType.SERVER:
			let isError = props.server.status === ServerStatus.DISCONNECTED;
			if (props.bouncerNetwork && props.bouncerNetwork.error) {
				isError = true;
			}
			if (isError) {
				classes.push("error");
			}
			break;
		case BufferType.NICK:
			let user = props.server.users.get(name);
			if (user && irc.isMeaningfulRealname(user.realname, name)) {
				title = stripANSI(user.realname);
			}
			break;
	}

	let icon = MessagesSquare;
	switch (props.buffer.type) {
		case BufferType.SERVER:
			icon = Server;
			break;
		case BufferType.NICK:
			icon = User;
			break;
	}

	let unread = null;
	if (props.buffer.unread !== Unread.NONE) {
		unread = html`<span class="unread-indicator" aria-label="Unread messages"></span>`;
	}

	return html`
		<li class="${classes.join(" ")}" role="tab" aria-selected="${props.active}">
			<a
				href=${getBufferURL(props.buffer, props.bouncerNetwork)}
				title=${title}
				onClick=${handleClick}
				onMouseDown=${handleMouseDown}
			>
				<${Icon} icon=${icon} class="buffer-icon" />
				<span class="buffer-name">${name}</span>
				${unread}
			</a>
		</li>
	`;
}

export default function BufferList(props) {
	let items = Array.from(props.buffers.values()).map((buf) => {
		let server = props.servers.get(buf.server);

		let bouncerNetwork = null;
		if (server.bouncerNetID) {
			bouncerNetwork = props.bouncerNetworks.get(server.bouncerNetID);
		}

		return html`
			<${BufferItem}
				key=${buf.id}
				buffer=${buf}
				server=${server}
				bouncerNetwork=${bouncerNetwork}
				onClick=${() => props.onBufferClick(buf)}
				onClose=${() => props.onBufferClose(buf)}
				active=${props.activeBuffer === buf.id}
			/>
		`;
	});

	return html`
		<ul class="buffer-items" role="tablist" aria-label="Buffer list">
			${items}
		</ul>
	`;
}
