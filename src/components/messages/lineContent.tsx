import type { MouseEvent, ReactNode } from "react";
import * as irc from "../../lib/irc";
import type { Message } from "../../lib/irc";
import { BufferType } from "../../state";
import RichText from "../RichText";
import Membership from "../Membership";
import type { Context } from "./context";
import { describeMode } from "./describeMode";

/** What a log line says */
export interface LineContent {
	/** Classes of the line, e.g. "talk highlight" */
	lineClass: string;
	/** The line with its sender, as shown in the compact layout */
	content: ReactNode;
	/** The text of a chat message without its sender, null for events */
	chatBody: ReactNode;
}

/**
 * Describe a message. sender is its nick, with its channel membership if
 * shown.
 */
export function describeLine(
	msg: Message,
	ctx: Context,
	redacted: boolean,
	sender: ReactNode,
	createNick: (nick: string) => ReactNode,
): LineContent {
	const { buffer: buf, server, bouncerNetwork, onChannelClick } = ctx;
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
							* {sender} <RichText text={ctcp.param} onLinkClick={onChannelClick} />
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
						{sender}
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
			content = <>The new account has been verified, you are now authenticated as {msg.params[1]}</>;
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

	return { lineClass, content, chatBody };
}
