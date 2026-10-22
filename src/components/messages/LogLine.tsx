import { memo, type ReactNode } from "react";
import { CornerUpRight } from "lucide-react";
import * as irc from "../../lib/irc";
import type { Message } from "../../lib/irc";
import { BufferType, getMessageURL } from "../../state";
import { getNickColorIndex, nickInitial } from "../../format";
import { strip as stripANSI } from "../../lib/ansi";
import { flash } from "../../lib/flash";
import { useAppState } from "../../app/context";
import Membership from "../Membership";
import MessageActions, { Reactions } from "../MessageActions";
import type { Context, MessageActionHandlers } from "./context";
import { describeLine } from "./lineContent";
import { makeNick } from "./nicks";
import Timestamp from "./Timestamp";

interface LogLineProps {
	message: Message;
	redacted: boolean;
	ctx: Context;
	reactions?: Map<string, string[]>;
	/** Message this one replies to, null if unknown */
	parent?: Message | null;
	/** Whether the message this one replies to was deleted */
	parentRedacted?: boolean;
	/** Position in a group of messages from the same sender (all but the compact layout) */
	group?: "first" | "continuation";
}

/** WeeChat-style prefix of event lines in the columns layout, and its kind */
function eventPrefix(command: string, lineClass: string): [string, string] {
	switch (command) {
		case "JOIN":
			return ["-->", "join"];
		case "PART":
		case "QUIT":
		case "KICK":
			return ["<--", "part"];
	}
	return lineClass.includes("error") ? ["=!=", "error"] : ["--", "info"];
}

/** The sender's channel membership shown before its nick, if enabled */
function senderMembership({ message, ctx }: LogLineProps): string | undefined {
	if (!ctx.settings.nickModes || ctx.buffer.type !== BufferType.CHANNEL) {
		return undefined;
	}
	return ctx.buffer.members.get(message.prefix?.name ?? "*");
}

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

/** Tagged as a bot by the message itself or by WHO replies */
function BotBadge({ serverID, nick, tagged }: { serverID: number; nick: string; tagged: boolean }) {
	const isBot = useAppState((s) => Boolean(s.servers.get(serverID)?.users.get(nick)?.bot));
	return tagged || isBot ? <span className="tag-badge">bot</span> : null;
}

function Avatar({ nick }: { nick: string }) {
	return (
		<span className={`avatar nick-${getNickColorIndex(nick)}`} aria-hidden="true">
			{nickInitial(nick)}
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
	flash(el);
	return true;
}

function ReplyQuote({
	parent,
	msgid,
	redacted,
}: {
	parent: Message | null;
	msgid: string;
	redacted: boolean;
}) {
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
				{redacted ? "This message has been deleted." : stripANSI(text)}
			</span>
		</button>
	);
}

const LogLine = memo(
	function LogLine({
		message: msg,
		redacted,
		ctx,
		reactions,
		parent,
		parentRedacted,
		group,
	}: LogLineProps) {
		const { buffer: buf, server, bouncerNetwork } = ctx;
		const createNick = makeNick(ctx);
		const from = msg.prefix?.name ?? "*";
		// The sender, with its channel membership prefix (e.g. "@") if enabled
		const senderModes = senderMembership({ message: msg, redacted, ctx });
		const sender = (
			<>
				<Membership value={senderModes?.slice(0, 1)} />
				{createNick(from)}
			</>
		);

		const described = describeLine(msg, ctx, redacted, sender, createNick);
		let lineClass = described.lineClass;
		const { content, chatBody } = described;

		if (!content) {
			return null;
		}

		const msgid = msg.tags.msgid;
		// Scroll anchors (see ChatScroller), and targets of reply quotes
		const lineAttrs = { "data-key": msg.key, "data-msgid": msgid ?? undefined };
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
				<ReplyQuote parent={parent ?? null} msgid={replyTo} redacted={Boolean(parentRedacted)} />
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
					{...lineAttrs}
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
								<BotBadge
									serverID={buf.server}
									nick={from}
									tagged={msg.tags.bot !== undefined}
								/>
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

		if (ctx.settings.layout === "columns") {
			let prefix: ReactNode;
			let prefixKind = "nick";
			let body: ReactNode = content;
			if (chatBody === null) {
				[prefix, prefixKind] = eventPrefix(msg.command, lineClass);
				lineClass += " event";
			} else if (lineClass.includes("me-tell")) {
				prefix = "*";
				prefixKind = "action";
				body = (
					<>
						{sender} {chatBody}
					</>
				);
			} else if (ctx.settings.hideRepeatedNicks && group === "continuation") {
				// Like WeeChat's prefix_same_nick: the column stays, empty
				prefix = null;
				body = chatBody;
			} else if (msg.command === "NOTICE") {
				prefix = <>-{sender}-</>;
				body = chatBody;
			} else if (ctx.settings.nickBrackets) {
				prefix = (
					<>
						<span className="nick-caret" aria-hidden="true">
							&lt;
						</span>
						{sender}
						<span className="nick-caret" aria-hidden="true">
							&gt;
						</span>
					</>
				);
				body = chatBody;
			} else {
				prefix = sender;
				body = chatBody;
			}
			return (
				<div
					className={`logline columns ${lineClass} group-${(chatBody !== null && group) || "first"}`}
					{...lineAttrs}
				>
					<Timestamp date={date} url={url} showSeconds={showSeconds} />
					<span className={`logline-prefix ${prefixKind}`}>{prefix}</span>
					<div className="logline-main">
						{quote}
						<span className="logline-content">{body}</span>
						{reactionsEl}
					</div>
					{actionsEl}
				</div>
			);
		}

		if (ctx.settings.layout === "bubbles") {
			if (chatBody === null) {
				return (
					<div className={`logline bubbles event ${lineClass}`} {...lineAttrs}>
						<span className="logline-content">{content}</span>
					</div>
				);
			}
			const mine = Boolean(server.nick) && server.cm(from) === server.cm(server.nick!);
			const isAction = lineClass.includes("me-tell");
			const first = group !== "continuation";
			return (
				<div
					className={`logline bubbles ${lineClass} group-${first ? "first" : "continuation"}${mine ? " mine" : ""}`}
					{...lineAttrs}
				>
					{first && !mine && <Avatar nick={from} />}
					{first && !mine && (
						<div className="bubble-sender">
							{createNick(from)}
							<BotBadge serverID={buf.server} nick={from} tagged={msg.tags.bot !== undefined} />
						</div>
					)}
					<div className="bubble">
						{quote}
						<span className="logline-content">{isAction ? content : chatBody}</span>
						<Timestamp date={date} url={url} showSeconds={false} />
					</div>
					{reactionsEl}
					{actionsEl}
				</div>
			);
		}

		return (
			<div className={`logline ${lineClass}`} {...lineAttrs}>
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
		prev.parentRedacted === next.parentRedacted &&
		prev.group === next.group &&
		sameActions(prev.ctx.actions, next.ctx.actions) &&
		prev.ctx.settings === next.ctx.settings &&
		prev.ctx.bouncerNetwork === next.ctx.bouncerNetwork &&
		// Used for message URLs and STATUSMSG prefixes
		prev.ctx.buffer.name === next.ctx.buffer.name &&
		prev.ctx.server.statusMsg === next.ctx.server.statusMsg &&
		// Shown before the sender's nick, and used to describe MODE changes.
		// Comparing the sender's membership rather than the member list keeps
		// lines from re-rendering on every join and part.
		senderMembership(prev) === senderMembership(next) &&
		prev.ctx.server.membershipModes === next.ctx.server.membershipModes &&
		// Own messages are told apart in the bubbles layout
		prev.ctx.server.nick === next.ctx.server.nick,
);

export default LogLine;
