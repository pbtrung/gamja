import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
import * as irc from "../lib/irc";
import type { Message } from "../lib/irc";
import {
	BufferType,
	ServerStatus,
	BufferEventsDisplayMode,
	getTargetMetadata,
	isMessageBeforeReceipt,
	type Buffer,
	type BouncerNetwork,
	type Server,
	type Settings,
} from "../state";
import { canFoldMessage, simplifyFoldGroup } from "../format";
import useMediaQuery, { SMALL_SCREEN } from "./useMediaQuery";
import { Clock12hContext, type Context, type MessageListHandlers } from "./messages/context";
import FoldGroup from "./messages/FoldGroup";
import LogLine from "./messages/LogLine";
import { AccountNagger, NotificationNagger, ProtocolHandlerNagger } from "./messages/Naggers";
import { DateSeparator, GapMarker, UnreadSeparator } from "./messages/Separators";

export type { MessageActionHandlers } from "./messages/context";

/** Messages from the same sender closer than this are grouped. */
const GROUP_TIMEOUT = 5 * 60 * 1000;

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
	const { buffer: buf, server } = props;
	// Small screens have no room for avatars, sender columns or bubbles: use
	// the compact style there, whatever the setting
	const smallScreen = useMediaQuery(SMALL_SCREEN);
	const settings = useMemo<Settings>(
		() =>
			smallScreen && props.settings.layout !== "compact"
				? { ...props.settings, layout: "compact" }
				: props.settings,
		[smallScreen, props.settings],
	);
	const ctx: Context = { ...props, settings };
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

	// Group consecutive messages from the same sender, but in the compact
	// layout
	let lastChat: Message | null = null;
	const groupOf = (msg: Message): "first" | "continuation" | undefined => {
		if (settings.layout === "compact") {
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
				parentRedacted={!!replyTo && buf.redacted.has(replyTo)}
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
	let gapShown = !buf.gap;
	const pushGap = () => {
		children.push(createFoldGroup(foldMessages));
		foldMessages = [];
		lastChat = null;
		children.push(<GapMarker key="gap" gap={buf.gap!} onLoad={props.onLoadGap} />);
		gapShown = true;
	};
	for (const msg of buf.messages) {
		const sep: ReactNode[] = [];

		// Before any filtering, so that the gap shows even if the message
		// right after it is hidden
		if (!gapShown && msg.tags.time! >= buf.gap!.before.time) {
			pushGap();
		}

		// Users blocked through soju's metadata
		if (msg.prefix && getTargetMetadata(server, msg.prefix.name).blocked) {
			continue;
		}

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
		if (settings.dateSeparators && !sameDate(prevDate, date)) {
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
	if (!gapShown) {
		pushGap();
	}
	children.push(createFoldGroup(foldMessages));

	// Layout options, applied by the stylesheet
	const listClasses = ["logline-list"];
	if (!settings.nickColors) {
		listClasses.push("no-nick-colors");
	}
	if (settings.nickAlign === "left") {
		listClasses.push("nick-align-left");
	}
	if (!settings.showTimestamps) {
		listClasses.push("no-timestamps");
	}
	if (settings.indentWrapped) {
		listClasses.push("indent-wrapped");
	}
	const listStyle = { "--nick-column-width": `${settings.nickColumnWidth}ch` } as CSSProperties;
	return (
		<Clock12hContext.Provider value={settings.clock12h}>
			<div className={listClasses.join(" ")} style={listStyle}>
				{children}
			</div>
		</Clock12hContext.Provider>
	);
}

export default memo(MessageList);
