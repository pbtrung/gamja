import { html } from "../lib/index.js";
import linkify from "../lib/linkify.js";
import { strip as stripANSI } from "../lib/ansi.js";
import { BufferType, ServerStatus, getServerName } from "../state.js";
import * as irc from "../lib/irc.js";
import Icon from "./icon.js";
import { CirclePlus, LogOut, MessagesSquare, PanelLeft, Plus, RotateCw, Server, Settings, SlidersHorizontal, User, Users, X } from "../icons.js";

const UserStatus = {
	HERE: "here",
	GONE: "gone",
	OFFLINE: "offline",
};

function NickStatus(props) {
	let textMap = {
		[UserStatus.HERE]: "User is online",
		[UserStatus.GONE]: "User is away",
		[UserStatus.OFFLINE]: "User is offline",
	};
	let text = textMap[props.status];
	return html`<span class="status status-${props.status}" title=${text} role="img" aria-label=${text}></span>`;
}

function ActionButton({ icon, label, danger, onClick }) {
	let variant = danger ? "btn-outline-danger" : "btn-outline-secondary";
	return html`
		<button
			type="button"
			class="btn btn-sm ${variant}"
			title=${label}
			onClick=${onClick}
		>
			<${Icon} icon=${icon}/>
			<span class="action-label">${label}</span>
		</button>
	`;
}

export default function BufferHeader(props) {
	let fullyConnected = props.server.status === ServerStatus.REGISTERED;
	if (props.bouncerNetwork) {
		fullyConnected = fullyConnected && props.bouncerNetwork.state === "connected";
	}

	let description = null, descriptionTitle = null, actions = [];
	switch (props.buffer.type) {
	case BufferType.SERVER:
		switch (props.server.status) {
		case ServerStatus.DISCONNECTED:
			description = "Disconnected";
			break;
		case ServerStatus.CONNECTING:
			description = "Connecting...";
			break;
		case ServerStatus.REGISTERING:
			description = "Logging in...";
			break;
		case ServerStatus.REGISTERED:
			if (props.bouncerNetwork) {
				switch (props.bouncerNetwork.state) {
				case "disconnected":
					description = "Bouncer disconnected from network";
					if (props.bouncerNetwork.error) {
						description += ": " + props.bouncerNetwork.error;
					}
					break;
				case "connecting":
					description = "Bouncer connecting to network...";
					break;
				case "connected":
					// host can be undefined e.g. when using UNIX domain sockets
					description = `Connected to ${props.bouncerNetwork.host || "network"}`;
					break;
				}
			} else if (props.buffer.serverInfo) {
				let serverInfo = props.buffer.serverInfo;
				description = `Connected to ${serverInfo.name}`;
			} else {
				description = "Connected";
			}
			break;
		}

		let joinButton = html`<${ActionButton} key="join" icon=${Plus} label="Join channel" onClick=${props.onJoin}/>`;
		let reconnectButton = html`<${ActionButton} key="reconect" icon=${RotateCw} label="Reconnect" onClick=${props.onReconnect}/>`;
		let settingsButton = html`<${ActionButton} key="settings" icon=${Settings} label="Settings" onClick=${props.onOpenSettings}/>`;

		if (props.server.isBouncer) {
			if (props.server.bouncerNetID) {
				if (fullyConnected) {
					actions.push(joinButton);
				}
				if (props.server.status === ServerStatus.REGISTERED) {
					actions.push(html`<${ActionButton} key="manage" icon=${SlidersHorizontal} label="Manage network" onClick=${props.onManageNetwork}/>`);
				}
			} else {
				if (fullyConnected) {
					actions.push(html`<${ActionButton} key="add" icon=${CirclePlus} label="Add network" onClick=${props.onAddNetwork}/>`);
				} else if (props.server.status === ServerStatus.DISCONNECTED) {
					actions.push(reconnectButton);
				}
				actions.push(settingsButton);
			}
		} else {
			if (fullyConnected) {
				actions.push(joinButton);
			} else if (props.server.status === ServerStatus.DISCONNECTED) {
				actions.push(reconnectButton);
			}
			actions.push(settingsButton);
		}
		break;
	case BufferType.CHANNEL:
		if (props.buffer.topic) {
			descriptionTitle = stripANSI(props.buffer.topic);
			description = linkify(descriptionTitle, props.onChannelClick);
		}
		if (props.buffer.joined) {
			actions.push(html`<${ActionButton} key="part" icon=${LogOut} label="Leave" danger onClick=${props.onClose}/>`);
		} else {
			if (fullyConnected) {
				actions.push(html`<${ActionButton} key="join" icon=${Plus} label="Join" onClick=${props.onJoin}/>`);
			}
			actions.push(html`<${ActionButton} key="part" icon=${X} label="Close" danger onClick=${props.onClose}/>`);
		}
		break;
	case BufferType.NICK:
		if (props.user) {
			let status = UserStatus.HERE;
			if (props.user.offline) {
				status = UserStatus.OFFLINE;
			} else if (props.user.away) {
				status = UserStatus.GONE;
			}

			let realname = props.buffer.name;
			if (irc.isMeaningfulRealname(props.user.realname, props.buffer.name)) {
				realname = stripANSI(props.user.realname || "");
			}

			let details = [];
			if (props.user.username && props.user.hostname) {
				details.push(`${props.user.username}@${props.user.hostname}`);
			}
			if (props.user.account) {
				let desc = `This user is verified and has logged in to the server with the account ${props.user.account}.`;
				let item;
				if (props.user.account === props.buffer.name) {
					item = "authenticated";
				} else {
					item = `authenticated as ${props.user.account}`;
				}
				details.push(html`<abbr title=${desc}>${item}</abbr>`);
			} else if (props.server.reliableUserAccounts) {
				// If the server supports MONITOR and WHOX, we can faithfully
				// keep user.account up-to-date for user queries
				let desc = "This user has not been verified and is not logged in.";
				details.push(html`<abbr title=${desc}>unauthenticated</abbr>`);
			}
			if (props.user.operator) {
				let desc = "This user is a server operator, they have administrator privileges.";
				details.push(html`<abbr title=${desc}>server operator</abbr>`);
			}
			if (props.user.bot) {
				let desc = "This user is an automated bot.";
				details.push(html`<abbr title=${desc}>bot</abbr>`);
			}
			details = details.map((item, i) => {
				if (i === 0) {
					return item;
				}
				return [", ", item];
			});
			if (details.length > 0) {
				details = ["(", details, ")"];
			}

			descriptionTitle = realname;
			description = html`<${NickStatus} status=${status}/> ${realname} ${details}`;
		}

		actions = html`<${ActionButton} key="close" icon=${X} label="Close" danger onClick=${props.onClose}/>`;
		break;
	}

	let name = props.buffer.name;
	if (props.buffer.type === BufferType.SERVER) {
		name = getServerName(props.server, props.bouncerNetwork);
	}

	if (typeof description === "string") {
		descriptionTitle = description;
	}

	let memberListToggle = null;
	if (props.buffer.type === BufferType.CHANNEL) {
		memberListToggle = html`
			<button
				type="button"
				class=${"header-toggle member-list-toggle" + (props.memberListHidden ? " always" : "")}
				title="Open member list"
				aria-label="Open member list"
				onClick=${props.onOpenMemberList}
			>
				<${Icon} icon=${Users}/>
			</button>
		`;
	}

	let typeIcon = MessagesSquare;
	switch (props.buffer.type) {
	case BufferType.SERVER:
		typeIcon = Server;
		break;
	case BufferType.NICK:
		typeIcon = User;
		break;
	}

	return html`
		<div class="title">
			<${Icon} icon=${typeIcon} class="title-icon"/>
			<button
				type="button"
				class="header-toggle buffer-list-toggle"
				title="Open buffer list"
				aria-label="Open buffer list"
				onClick=${props.onOpenBufferList}
			>
				<${Icon} icon=${PanelLeft}/>
				${props.unreadElsewhere ? html`<span class="unread-indicator unread-${props.unreadElsewhere}"></span>` : null}
			</button>
			<span class="text-truncate" title=${name}>${name}</span>
			${memberListToggle}
		</div>
		${description ? html`<div class="description" title=${descriptionTitle}>${description}</div>` : null}
		<div class="actions">${actions}</div>
	`;
}
