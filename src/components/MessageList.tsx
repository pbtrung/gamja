import { memo, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { CornerUpRight } from "lucide-react";
import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import {
	BufferType,
	ServerStatus,
	BufferEventsDisplayMode,
	getMessageURL,
	isMessageBeforeReceipt,
	type Buffer,
	type BouncerNetwork,
	type Server,
	type Settings,
} from "../state";
import * as store from "../store";
import { canFoldMessage, getNickColorIndex, registerProtocolHandler, simplifyFoldGroup } from "../format";
import Membership from "./Membership";
import Nick from "./Nick";
import RichText, { type LinkClickHandler } from "./RichText";
import MessageActions, { Reactions } from "./MessageActions";
import { strip as stripANSI } from "../lib/ansi";

export interface MessageActionHandlers {
	myNick: string | null;
	canReact: boolean;
	canReply: boolean;
	canRedact: boolean;
	onReact: (msg: Message, emoji: string) => void;
	onReply: (msg: Message) => void;
	onRedact: (msg: Message) => void;
}

export interface MessageListHandlers {
	actions?: MessageActionHandlers;
	onChannelClick: LinkClickHandler;
	onNickClick: (nick: string) => void;
	onAuthClick: () => void;
	onRegisterClick: () => void;
	onVerifyClick: (account: string, message: string) => void;
	onRetryHistory?: () => void;
}

interface Context extends MessageListHandlers {
	buffer: Buffer;
	server: Server;
	bouncerNetwork: BouncerNetwork | null;
	settings: Settings;
}

function formatTime(date: Date, showSeconds: boolean): string {
	const hh = date.getHours().toString().padStart(2, "0");
	const mm = date.getMinutes().toString().padStart(2, "0");
	let timestamp = `${hh}:${mm}`;
	if (showSeconds) {
		timestamp += ":" + date.getSeconds().toString().padStart(2, "0");
	}
	return timestamp;
}

function Timestamp({ date, url, showSeconds }: { date?: Date; url?: string | null; showSeconds: boolean }) {
	if (!date) {
		const placeholder = showSeconds ? "--:--:--" : "--:--";
		return (
			<span className="timestamp" aria-hidden="true">
				{placeholder}
			</span>
		);
	}

	return (
		<a
			href={url ?? undefined}
			className="timestamp"
			title={date.toLocaleString()}
			onClick={(event) => event.preventDefault()}
		>
			<time dateTime={date.toISOString()}>{formatTime(date, showSeconds)}</time>
		</a>
	);
}

function makeNick(ctx: Context) {
	return function createNick(nick: string, key?: string | number) {
		return (
			<Nick
				key={key}
				nick={nick}
				user={ctx.server.users.get(nick)}
				bouncerNetwork={ctx.bouncerNetwork}
				onClick={ctx.onNickClick}
			/>
		);
	};
}

/** Whether compact lines show the sender in a right-aligned column, like WeeChat */
function hasNickColumn(ctx: Context): boolean {
	return ctx.settings.layout === "compact" && ctx.buffer.type !== BufferType.SERVER;
}

/** WeeChat-style marker shown in the nick column for events */
function eventMarker(command: string): string {
	switch (command) {
		case "JOIN":
			return "-->";
		case "PART":
		case "QUIT":
		case "KICK":
			return "<--";
		default:
			return "--";
	}
}

const MODE_DESCRIPTIONS: Record<string, [string, string]> = {
	i: ["marked the channel as invite-only", "unmarked the channel as invite-only"],
	m: ["marked the channel as moderated", "unmarked the channel as moderated"],
	s: ["marked the channel as secret", "unmarked the channel as secret"],
	t: ["locked the channel topic", "unlocked the channel topic"],
	n: ["denied external messages to this channel", "allowed external messages to this channel"],
};

function describeMode(msg: Message, ctx: Context, createNick: (nick: string) => ReactNode): ReactNode {
	const { buffer: buf, server } = ctx;
	const target = msg.params[0];
	const modeStr = msg.params[1];
	const user = createNick(msg.prefix?.name ?? "*");

	// TODO: use irc.forEachChannelModeUpdate()
	if (
		buf.type === BufferType.CHANNEL &&
		modeStr.length === 2 &&
		server.cm(buf.name) === server.cm(target)
	) {
		const plus = modeStr[0] === "+";
		const mode = modeStr[1];
		const arg = msg.params[2];

		switch (mode) {
			case "b":
				return (
					<>
						{user} has {plus ? "added" : "removed"} a ban on {arg}
					</>
				);
			case "e":
				return (
					<>
						{user} has {plus ? "added" : "removed"} a ban exemption on {arg}
					</>
				);
			case "l":
				return plus ? (
					<>
						{user} has set the channel user limit to {arg}
					</>
				) : (
					<>{user} has unset the channel user limit</>
				);
		}
		if (MODE_DESCRIPTIONS[mode]) {
			return (
				<>
					{user} has {MODE_DESCRIPTIONS[mode][plus ? 0 : 1]}
				</>
			);
		}

		// Channel membership modes
		const membership = server.membershipModes?.find((m) => m.mode === mode);
		const membershipName = membership ? irc.STD_MEMBERSHIP_NAMES[membership.prefix] : null;
		if (membershipName && arg) {
			return (
				<>
					{user} has {plus ? "granted" : "revoked"} {membershipName} privileges{" "}
					{plus ? "to" : "from"} {createNick(arg)}
				</>
			);
		}
	}

	return (
		<>
			{user} sets mode {msg.params.slice(1).join(" ")}
			{server.cm(buf.name) !== server.cm(target) ? <> on {target}</> : null}
		</>
	);
}

interface LogLineProps {
	message: Message;
	redacted: boolean;
	ctx: Context;
	reactions?: Map<string, string[]>;
	/** Message this one replies to, null if unknown */
	parent?: Message | null;
	/** Position in a group of messages from the same sender (comfortable layout) */
	group?: "first" | "continuation";
}

/** Messages from the same sender closer than this are grouped. */
const GROUP_TIMEOUT = 5 * 60 * 1000;

function sameActions(a: MessageActionHandlers | undefined, b: MessageActionHandlers | undefined): boolean {
	if (!a || !b) {
		return a === b;
	}
	return (
		a.myNick === b.myNick &&
		a.canReact === b.canReact &&
		a.canReply === b.canReply &&
		a.canRedact === b.canRedact
	);
}

function Avatar({ nick }: { nick: string }) {
	return (
		<span className={`avatar nick-${getNickColorIndex(nick)}`} aria-hidden="true">
			{nick.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0) || nick.charAt(0)}
		</span>
	);
}

/** Scroll to a message and briefly highlight it. */
function jumpToMessage(msgid: string): boolean {
	const el = document.querySelector<HTMLElement>(`[data-msgid="${CSS.escape(msgid)}"]`);
	if (!el) {
		return false;
	}
	el.scrollIntoView?.({ block: "center", behavior: "smooth" });
	el.classList.remove("flash");
	void el.offsetWidth; // restart the animation
	el.classList.add("flash");
	return true;
}

function ReplyQuote({ parent, msgid, ctx }: { parent: Message | null; msgid: string; ctx: Context }) {
	if (!parent) {
		return (
			<div className="reply-quote missing">
				<CornerUpRight aria-hidden="true" /> Reply to an earlier message
			</div>
		);
	}
	const text = irc.parseCTCP(parent)?.param ?? parent.params[1] ?? "";
	const nick = parent.prefix?.name ?? "*";
	return (
		<button
			type="button"
			className="reply-quote"
			title="Jump to the original message"
			onClick={() => jumpToMessage(msgid)}
		>
			<CornerUpRight aria-hidden="true" />
			<span className={`reply-nick nick-${getNickColorIndex(nick)}`}>{nick}</span>
			<span className="reply-text">
				{ctx.buffer.redacted.has(msgid) ? "This message has been deleted." : stripANSI(text)}
			</span>
		</button>
	);
}

const LogLine = memo(
	function LogLine({ message: msg, redacted, ctx, reactions, parent, group }: LogLineProps) {
		const { buffer: buf, server, bouncerNetwork, onChannelClick } = ctx;
		const createNick = makeNick(ctx);
		const from = msg.prefix?.name ?? "*";

		function createChannel(channel: string) {
			const url = irc.formatURL({ host: bouncerNetwork?.host ?? undefined, entity: channel });
			return (
				<a href={url} onClick={onChannelClick}>
					{channel}
				</a>
			);
		}

		let lineClass = "";
		let content: ReactNode = null;
		// Message text without the sender, for the comfortable layout
		let chatBody: ReactNode = null;
		switch (msg.command) {
			case "NOTICE":
			case "PRIVMSG": {
				const target = msg.params[0];
				const text = msg.params[1] ?? "";

				const ctcp = irc.parseCTCP(msg);
				if (ctcp) {
					if (ctcp.command === "ACTION") {
						lineClass = "me-tell";
						content = (
							<>
								* {createNick(from)}{" "}
								<RichText text={ctcp.param} onLinkClick={onChannelClick} />
							</>
						);
						chatBody = <RichText text={ctcp.param} onLinkClick={onChannelClick} />;
					} else {
						content = (
							<>
								{createNick(from)} has sent a CTCP command: {ctcp.command} {ctcp.param}
							</>
						);
					}
				} else {
					let prefix = "<",
						suffix = ">";
					if (msg.command === "NOTICE") {
						lineClass += " notice";
						prefix = suffix = "-";
					}
					let body: ReactNode;
					if (redacted) {
						body = <i className="muted">This message has been deleted.</i>;
					} else {
						body = <RichText text={text} onLinkClick={onChannelClick} />;
						lineClass += " talk";
					}
					content = (
						<>
							<span className="nick-caret" aria-hidden="true">
								{prefix}
							</span>
							{createNick(from)}
							<span className="nick-caret" aria-hidden="true">
								{suffix}
							</span>{" "}
							{body}
						</>
					);
					chatBody = body;
				}

				const allowedPrefixes = server.statusMsg;
				if (target !== buf.name && allowedPrefixes) {
					const parts = irc.parseTargetPrefix(target, allowedPrefixes);
					if (parts.name === buf.name) {
						content = (
							<>
								(<Membership value={parts.prefix} />) {content}
							</>
						);
						chatBody = (
							<>
								(<Membership value={parts.prefix} />) {chatBody}
							</>
						);
					}
				}

				if (msg.tags["+draft/channel-context"]) {
					content = (
						<>
							<em>(only visible to you)</em> {content}
						</>
					);
					chatBody = (
						<>
							<em>(only visible to you)</em> {chatBody}
						</>
					);
				}

				if (msg.isHighlight) {
					lineClass += " highlight";
				}
				break;
			}
			case "JOIN":
				content = <>{createNick(from)} has joined</>;
				break;
			case "PART":
				content = (
					<>
						{createNick(from)} has left
						{msg.params[1] ? <> ({msg.params[1]})</> : null}
					</>
				);
				break;
			case "QUIT":
				content = (
					<>
						{createNick(from)} has quit
						{msg.params[0] ? <> ({msg.params[0]})</> : null}
					</>
				);
				break;
			case "NICK":
				content = (
					<>
						{createNick(from)} is now known as {createNick(msg.params[0])}
					</>
				);
				break;
			case "KICK":
				content = (
					<>
						{createNick(msg.params[1])} was kicked by {createNick(from)}
						{msg.params[2] ? <> ({msg.params[2]})</> : null}
					</>
				);
				break;
			case "MODE":
				content = describeMode(msg, ctx, createNick);
				break;
			case "TOPIC": {
				const topic = msg.params[1];
				if (topic) {
					content = (
						<>
							{createNick(from)} changed the topic to:{" "}
							<RichText text={topic} onLinkClick={onChannelClick} />
						</>
					);
				} else {
					content = <>{createNick(from)} cleared the topic</>;
				}
				break;
			}
			case "INVITE": {
				const invitee = msg.params[0];
				const channel = msg.params[1];
				// TODO: instead of checking buffer type, check if invitee is our nick
				if (buf.type === BufferType.SERVER) {
					lineClass = "talk";
					content = (
						<>
							You have been invited to {createChannel(channel)} by {createNick(from)}
						</>
					);
				} else {
					content = (
						<>
							{createNick(from)} has invited {createNick(invitee)} to the channel
						</>
					);
				}
				break;
			}
			case "RENAME":
				content = (
					<>
						The channel has been renamed from {msg.params[0]} to {msg.params[1]}
						{msg.params[2] ? <> ({msg.params[2]})</> : null}
					</>
				);
				break;
			case "FAIL":
			case "WARN":
			case "NOTE": {
				// Standard replies: <command> <code> [context...] <description>
				lineClass = msg.command === "FAIL" ? "error" : msg.command === "WARN" ? "warning" : "";
				const command = msg.params[0] === "*" ? "" : msg.params[0] + ": ";
				content = (
					<>
						{command}
						<RichText text={msg.params[msg.params.length - 1]} onLinkClick={onChannelClick} />
					</>
				);
				break;
			}
			case irc.RPL_WELCOME:
				content = <>Connected to server, your nickname is {msg.params[0]}</>;
				break;
			case irc.RPL_INVITING:
				content = <>{createNick(msg.params[1])} has been invited to the channel</>;
				break;
			case irc.RPL_MOTD:
				lineClass = "motd";
				content = <RichText text={msg.params[1]} onLinkClick={onChannelClick} />;
				break;
			case irc.RPL_LOGGEDIN:
				content = <>You are now authenticated as {msg.params[2]}</>;
				break;
			case irc.RPL_LOGGEDOUT:
				content = <>You are now unauthenticated</>;
				break;
			case "REGISTER": {
				const account = msg.params[1];
				const reason = msg.params[2];

				const handleVerifyClick = (event: MouseEvent) => {
					event.preventDefault();
					ctx.onVerifyClick(account, reason);
				};

				switch (msg.params[0]) {
					case "SUCCESS":
						content = <>A new account has been created, you are now authenticated as {account}</>;
						break;
					case "VERIFICATION_REQUIRED":
						content = (
							<>
								A new account has been created, but you need to{" "}
								<a href="#" onClick={handleVerifyClick}>
									verify it
								</a>
								: <RichText text={reason} onLinkClick={onChannelClick} />
							</>
						);
						break;
				}
				break;
			}
			case "VERIFY":
				content = (
					<>The new account has been verified, you are now authenticated as {msg.params[1]}</>
				);
				break;
			case irc.RPL_UMODEIS: {
				const mode = msg.params[1];
				content = mode ? <>Your user mode is {mode}</> : <>You have no user mode</>;
				break;
			}
			case irc.RPL_CHANNELMODEIS:
				content = <>Channel mode is {msg.params.slice(2).join(" ")}</>;
				break;
			case irc.RPL_CREATIONTIME: {
				const date = new Date(parseInt(msg.params[2], 10) * 1000);
				content = <>Channel was created on {date.toLocaleString()}</>;
				break;
			}
			// MONITOR messages are only displayed in user buffers
			case irc.RPL_MONONLINE:
				content = <>{createNick(buf.name)} is online</>;
				break;
			case irc.RPL_MONOFFLINE:
				content = <>{createNick(buf.name)} is offline</>;
				break;
			default: {
				const isNumeric = /^\d{3}$/.test(msg.command);
				if (irc.isError(msg.command) && msg.command !== irc.ERR_NOMOTD) {
					lineClass = "error";
				}
				// Numeric replies start with our nick, which isn't worth showing
				const text = isNumeric ? msg.params.slice(1).join(" ") : msg.params.join(" ");
				content = (
					<>
						{isNumeric ? null : msg.command + " "}
						<RichText text={text} onLinkClick={onChannelClick} />
					</>
				);
			}
		}

		if (!content) {
			return null;
		}

		const msgid = msg.tags.msgid;
		const ctcp = irc.parseCTCP(msg);
		const isChat =
			(msg.command === "PRIVMSG" || msg.command === "NOTICE") && (!ctcp || ctcp.command === "ACTION");
		const actions = ctx.actions;
		const isMine = (nick: string) =>
			Boolean(actions?.myNick) && server.cm(nick) === server.cm(actions!.myNick!);
		const replyTo = msg.tags["+draft/reply"];

		const date = new Date(msg.tags.time!);
		const url = getMessageURL(buf, msg, bouncerNetwork);
		const showSeconds = ctx.settings.secondsInTimestamps;
		const quote =
			isChat && replyTo && !redacted ? (
				<ReplyQuote parent={parent ?? null} msgid={replyTo} ctx={ctx} />
			) : null;
		const reactionsEl =
			isChat && reactions && reactions.size > 0 && !redacted ? (
				<Reactions
					reactions={reactions}
					isMine={isMine}
					canReact={Boolean(actions?.canReact)}
					onToggle={(emoji) => actions?.onReact(msg, emoji)}
				/>
			) : null;
		const actionsEl =
			isChat && msgid && !redacted && actions ? (
				<MessageActions
					canReact={actions.canReact}
					canReply={actions.canReply}
					canRedact={actions.canRedact && isMine(from)}
					onReact={(emoji) => actions.onReact(msg, emoji)}
					onReply={() => actions.onReply(msg)}
					onRedact={() => actions.onRedact(msg)}
				/>
			) : null;

		if (ctx.settings.layout === "comfortable") {
			const isGroupedChat = Boolean(group) && chatBody !== null;
			return (
				<div
					className={`logline comfortable ${lineClass} ${isGroupedChat ? "group-" + group : "event"}`}
					data-key={msg.key}
					data-msgid={msgid ?? undefined}
				>
					<div className="logline-gutter">
						{isGroupedChat && group === "first" ? (
							<Avatar nick={from} />
						) : (
							<Timestamp date={date} url={url} showSeconds={false} />
						)}
					</div>
					<div className="logline-main">
						{quote}
						{isGroupedChat && group === "first" && (
							<div className="logline-header">
								{createNick(from)}
								{ctx.server.users.get(from)?.bot && <span className="tag-badge">bot</span>}
								<Timestamp date={date} url={url} showSeconds={showSeconds} />
							</div>
						)}
						<div className="logline-content">{isGroupedChat ? chatBody : content}</div>
						{reactionsEl}
					</div>
					{actionsEl}
				</div>
			);
		}

		if (hasNickColumn(ctx)) {
			let prefix: ReactNode = eventMarker(msg.command);
			let body = content;
			if (chatBody !== null && lineClass.includes("me-tell")) {
				prefix = "*";
				body = (
					<>
						{createNick(from)} {chatBody}
					</>
				);
			} else if (chatBody !== null) {
				const [open, close] = msg.command === "NOTICE" ? ["-", "-"] : ["<", ">"];
				prefix = (
					<>
						<span className="nick-caret" aria-hidden="true">
							{open}
						</span>
						{createNick(from)}
						<span className="nick-caret" aria-hidden="true">
							{close}
						</span>
					</>
				);
				body = chatBody;
			}
			return (
				<div
					className={`logline nick-column ${lineClass} ${chatBody === null ? "event" : ""}`}
					data-key={msg.key}
					data-msgid={msgid ?? undefined}
				>
					{quote}
					<Timestamp date={date} url={url} showSeconds={showSeconds} />{" "}
					<span className="logline-prefix">{prefix}</span>{" "}
					<span className="logline-content">{body}</span>
					{reactionsEl}
					{actionsEl}
				</div>
			);
		}

		return (
			<div className={`logline ${lineClass}`} data-key={msg.key} data-msgid={msgid ?? undefined}>
				{quote}
				<Timestamp date={date} url={url} showSeconds={showSeconds} />{" "}
				<span className="logline-content">{content}</span>
				{reactionsEl}
				{actionsEl}
			</div>
		);
	},
	(prev, next) =>
		prev.message === next.message &&
		prev.redacted === next.redacted &&
		prev.reactions === next.reactions &&
		prev.parent === next.parent &&
		prev.group === next.group &&
		sameActions(prev.ctx.actions, next.ctx.actions) &&
		prev.ctx.settings === next.ctx.settings &&
		prev.ctx.server.users === next.ctx.server.users,
);

function createNickList(
	nicks: string[],
	createNick: (nick: string, key?: string | number) => ReactNode,
): ReactNode {
	if (nicks.length === 0) {
		return null;
	} else if (nicks.length === 1) {
		return createNick(nicks[0]);
	}

	const l: ReactNode[] = [];
	nicks.slice(0, -1).forEach((nick, i) => {
		if (i > 0) {
			l.push(", ");
		}
		l.push(createNick(nick, nick));
	});
	l.push(" and ");
	l.push(createNick(nicks[nicks.length - 1], nicks[nicks.length - 1]));
	return l;
}

function FoldGroup({ messages: msgs, ctx }: { messages: Message[]; ctx: Context }) {
	const createNick = makeNick(ctx);

	const byCommand: Record<string, Message[]> = {
		JOIN: [],
		PART: [],
		QUIT: [],
		NICK: [],
	};
	for (const msg of msgs) {
		byCommand[msg.command].push(msg);
	}

	const content: ReactNode[] = [];
	const verbs: Record<string, [string, string]> = {
		JOIN: ["has joined", "have joined"],
		PART: ["has left", "have left"],
		QUIT: ["has quit", "have quit"],
	};
	for (const cmd of ["JOIN", "PART", "QUIT"]) {
		if (byCommand[cmd].length === 0) {
			continue;
		}

		const nicks = [...new Set(byCommand[cmd].map((msg) => msg.prefix?.name ?? "*"))];
		if (content.length > 0) {
			content.push(", ");
		}
		content.push(
			<span key={cmd}>
				{createNickList(nicks, createNick)} {verbs[cmd][nicks.length > 1 ? 1 : 0]}
			</span>,
		);
	}

	for (const msg of byCommand.NICK) {
		if (content.length > 0) {
			content.push(", ");
		}
		content.push(
			<span key={"nick-" + msg.key}>
				{createNick(msg.prefix?.name ?? "*")} is now known as {createNick(msg.params[0])}
			</span>,
		);
	}

	const lastMsg = msgs[msgs.length - 1];
	const firstDate = new Date(msgs[0].tags.time!);
	const lastDate = new Date(lastMsg.tags.time!);
	const showSeconds = ctx.settings.secondsInTimestamps;
	let timestamp: ReactNode = (
		<Timestamp
			date={firstDate}
			url={getMessageURL(ctx.buffer, msgs[0], ctx.bouncerNetwork)}
			showSeconds={showSeconds}
		/>
	);
	if (lastDate.getTime() - firstDate.getTime() > 60 * 1000) {
		timestamp = (
			<>
				{timestamp} —{" "}
				<Timestamp
					date={lastDate}
					url={getMessageURL(ctx.buffer, lastMsg, ctx.bouncerNetwork)}
					showSeconds={showSeconds}
				/>
			</>
		);
	}

	if (ctx.settings.layout === "comfortable") {
		return (
			<div className="logline comfortable event fold-group" data-key={msgs[0].key}>
				<div className="logline-gutter">
					<Timestamp
						date={firstDate}
						url={getMessageURL(ctx.buffer, msgs[0], ctx.bouncerNetwork)}
						showSeconds={false}
					/>
				</div>
				<div className="logline-main">
					<div className="logline-content">{content}</div>
				</div>
			</div>
		);
	}

	if (hasNickColumn(ctx)) {
		// Like the comfortable layout, only the first time fits in the column
		return (
			<div className="logline nick-column event fold-group" data-key={msgs[0].key}>
				<Timestamp
					date={firstDate}
					url={getMessageURL(ctx.buffer, msgs[0], ctx.bouncerNetwork)}
					showSeconds={showSeconds}
				/>{" "}
				<span className="logline-prefix">--</span> <span className="logline-content">{content}</span>
			</div>
		);
	}

	return (
		<div className="logline fold-group" data-key={msgs[0].key}>
			{timestamp} <span className="logline-content">{content}</span>
		</div>
	);
}

function notificationsSupported(): boolean {
	return "Notification" in globalThis;
}

function NotificationNagger({ showSeconds }: { showSeconds: boolean }) {
	const shouldNag = () => notificationsSupported() && Notification.permission === "default";
	const [nag, setNag] = useState(shouldNag);

	if (!nag) {
		return null;
	}

	function handleClick(event: MouseEvent) {
		event.preventDefault();
		Notification.requestPermission().then(() => setNag(shouldNag()));
	}

	return (
		<div className="logline nag">
			<Timestamp showSeconds={showSeconds} />{" "}
			<span className="logline-content">
				<a href="#" onClick={handleClick}>
					Turn on desktop notifications
				</a>{" "}
				to get notified about new messages
			</span>
		</div>
	);
}

function ProtocolHandlerNagger({
	bouncerName,
	showSeconds,
}: {
	bouncerName: string | null;
	showSeconds: boolean;
}) {
	const [nag, setNag] = useState(() => !store.naggedProtocolHandler.load());

	if (!("registerProtocolHandler" in navigator) || !nag) {
		return null;
	}

	function handleClick(event: MouseEvent) {
		event.preventDefault();
		registerProtocolHandler();
		store.naggedProtocolHandler.put(true);
		setNag(false);
	}

	return (
		<div className="logline nag">
			<Timestamp showSeconds={showSeconds} />{" "}
			<span className="logline-content">
				<a href="#" onClick={handleClick}>
					Register our protocol handler
				</a>{" "}
				to open IRC links with {bouncerName || "this bouncer"}
			</span>
		</div>
	);
}

function AccountNagger({ ctx }: { ctx: Context }) {
	const { server } = ctx;
	const accDesc = server.name ? "a " + server.name + " account" : "an account on this server";

	function handleAuthClick(event: MouseEvent) {
		event.preventDefault();
		ctx.onAuthClick();
	}
	function handleRegisterClick(event: MouseEvent) {
		event.preventDefault();
		ctx.onRegisterClick();
	}

	return (
		<div className="logline nag">
			<Timestamp showSeconds={ctx.settings.secondsInTimestamps} />{" "}
			<span className="logline-content">
				You are unauthenticated on this server,{" "}
				<a href="#" onClick={handleAuthClick}>
					login
				</a>{" "}
				{server.supportsAccountRegistration ? (
					<>
						or{" "}
						<a href="#" onClick={handleRegisterClick}>
							register
						</a>{" "}
						{accDesc}
					</>
				) : (
					<>if you have {accDesc}</>
				)}
			</span>
		</div>
	);
}

function DateSeparator({ date }: { date: Date }) {
	const text = date.toLocaleDateString([], {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});
	return (
		<div className="separator date-separator" role="separator">
			{text}
		</div>
	);
}

function UnreadSeparator() {
	return (
		<div className="separator unread-separator" role="separator">
			New messages
		</div>
	);
}

function sameDate(d1: Date, d2: Date): boolean {
	return (
		d1.getFullYear() === d2.getFullYear() &&
		d1.getMonth() === d2.getMonth() &&
		d1.getDate() === d2.getDate()
	);
}

interface MessageListProps extends MessageListHandlers {
	buffer: Buffer;
	server: Server;
	bouncerNetwork: BouncerNetwork | null;
	settings: Settings;
}

function MessageList(props: MessageListProps) {
	const { buffer: buf, server, settings } = props;
	const ctx: Context = props;
	const showSeconds = settings.secondsInTimestamps;

	// Index messages by ID to resolve replies
	const byMsgid = useMemo(() => {
		const m = new Map<string, Message>();
		for (const msg of buf.messages) {
			if (msg.tags.msgid) {
				m.set(msg.tags.msgid, msg);
			}
		}
		return m;
	}, [buf.messages]);

	const children: ReactNode[] = [];
	if (buf.history === "loading") {
		children.push(
			<div key="history-loading" className="history-status" role="status">
				<span className="spinner" aria-hidden="true" /> Loading older messages…
			</div>,
		);
	} else if (buf.history === "error") {
		children.push(
			<div key="history-error" className="history-status" role="alert">
				Failed to load older messages.
				<button type="button" className="btn btn-sm" onClick={props.onRetryHistory}>
					Retry
				</button>
			</div>,
		);
	} else if (buf.history === "end" && buf.type !== BufferType.SERVER) {
		children.push(
			<div key="history-end" className="history-status history-start">
				<span>
					{buf.type === BufferType.CHANNEL ? (
						<>
							This is the beginning of <strong>{buf.name}</strong>
						</>
					) : (
						<>
							This is the beginning of your conversation with <strong>{buf.name}</strong>
						</>
					)}
				</span>
			</div>,
		);
	}
	if (buf.type === BufferType.SERVER) {
		children.push(<NotificationNagger key="nag-notif" showSeconds={showSeconds} />);
	}
	if (buf.type === BufferType.SERVER && server.isBouncer && !server.bouncerNetID) {
		children.push(
			<ProtocolHandlerNagger key="nag-proto" bouncerName={server.name} showSeconds={showSeconds} />,
		);
	}
	if (
		buf.type === BufferType.SERVER &&
		server.status === ServerStatus.REGISTERED &&
		server.supportsSASLPlain &&
		!server.account
	) {
		children.push(<AccountNagger key="nag-account" ctx={ctx} />);
	}

	// Group consecutive messages from the same sender in the comfortable layout
	let lastChat: Message | null = null;
	const groupOf = (msg: Message): "first" | "continuation" | undefined => {
		if (settings.layout !== "comfortable") {
			return undefined;
		}
		const isChat = msg.command === "PRIVMSG" || msg.command === "NOTICE";
		const ctcp = isChat ? irc.parseCTCP(msg) : null;
		if (!isChat || (ctcp && ctcp.command !== "ACTION")) {
			lastChat = null;
			return undefined;
		}
		const prev = lastChat;
		lastChat = msg;
		if (
			prev &&
			prev.command === msg.command &&
			prev.prefix?.name === msg.prefix?.name &&
			!msg.tags["+draft/reply"] &&
			new Date(msg.tags.time!).getTime() - new Date(prev.tags.time!).getTime() < GROUP_TIMEOUT
		) {
			return "continuation";
		}
		return "first";
	};

	const createLogLine = (msg: Message) => {
		const msgid = msg.tags.msgid;
		const replyTo = msg.tags["+draft/reply"];
		return (
			<LogLine
				key={"msg-" + msg.key}
				message={msg}
				redacted={!!msgid && buf.redacted.has(msgid)}
				reactions={msgid ? buf.reactions.get(msgid) : undefined}
				parent={replyTo ? (byMsgid.get(replyTo) ?? null) : undefined}
				group={groupOf(msg)}
				ctx={ctx}
			/>
		);
	};
	const createFoldGroup = (msgs: Message[]) => {
		msgs = simplifyFoldGroup(msgs);
		if (msgs.length === 0) {
			return null;
		} else if (msgs.length === 1) {
			return createLogLine(msgs[0]);
		}
		return (
			<FoldGroup
				key={"fold-" + msgs[0].key + "-" + msgs[msgs.length - 1].key}
				messages={msgs}
				ctx={ctx}
			/>
		);
	};

	let hasUnreadSeparator = false;
	let prevDate = new Date();
	let foldMessages: Message[] = [];
	let lastMonitor: string | null = null;
	for (const msg of buf.messages) {
		const sep: ReactNode[] = [];

		if (settings.bufferEvents === BufferEventsDisplayMode.HIDE && canFoldMessage(msg)) {
			continue;
		}

		if (msg.command === irc.RPL_MONONLINE || msg.command === irc.RPL_MONOFFLINE) {
			const skip = !lastMonitor || msg.command === lastMonitor;
			lastMonitor = msg.command;
			if (skip) {
				continue;
			}
		}

		if (
			!hasUnreadSeparator &&
			buf.type !== BufferType.SERVER &&
			!isMessageBeforeReceipt(msg, buf.prevReadReceipt)
		) {
			sep.push(<UnreadSeparator key="unread" />);
			hasUnreadSeparator = true;
		}

		const date = new Date(msg.tags.time!);
		if (!sameDate(prevDate, date)) {
			sep.push(<DateSeparator key={"date-" + msg.key} date={date} />);
		}
		prevDate = date;

		if (sep.length > 0) {
			children.push(createFoldGroup(foldMessages));
			children.push(...sep);
			foldMessages = [];
			lastChat = null;
		}

		// TODO: consider checking the time difference too
		if (settings.bufferEvents === BufferEventsDisplayMode.FOLD && canFoldMessage(msg)) {
			foldMessages.push(msg);
			lastChat = null;
			continue;
		}

		if (foldMessages.length > 0) {
			children.push(createFoldGroup(foldMessages));
			foldMessages = [];
		}

		children.push(createLogLine(msg));
	}
	children.push(createFoldGroup(foldMessages));

	return <div className="logline-list">{children}</div>;
}

export default MessageList;
