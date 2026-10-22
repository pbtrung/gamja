import type { ReactNode } from "react";
import type { Message } from "../../lib/irc";
import { getMessageURL } from "../../state";
import type { Context } from "./context";
import { createNickList, makeNick } from "./nicks";
import Timestamp from "./Timestamp";

export default function FoldGroup({ messages: msgs, ctx }: { messages: Message[]; ctx: Context }) {
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
			<span className="timestamp-range">
				{timestamp} —{" "}
				<Timestamp
					date={lastDate}
					url={getMessageURL(ctx.buffer, lastMsg, ctx.bouncerNetwork)}
					showSeconds={showSeconds}
				/>
			</span>
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

	if (ctx.settings.layout === "columns") {
		return (
			<div className="logline columns event fold-group" data-key={msgs[0].key}>
				<Timestamp
					date={firstDate}
					url={getMessageURL(ctx.buffer, msgs[0], ctx.bouncerNetwork)}
					showSeconds={showSeconds}
				/>
				<span className="logline-prefix info">--</span>
				<div className="logline-main">
					<span className="logline-content">{content}</span>
				</div>
			</div>
		);
	}

	if (ctx.settings.layout === "bubbles") {
		return (
			<div className="logline bubbles event fold-group" data-key={msgs[0].key}>
				<span className="logline-content">{content}</span>
			</div>
		);
	}

	return (
		<div className="logline fold-group" data-key={msgs[0].key}>
			{timestamp} <span className="logline-content">{content}</span>
		</div>
	);
}
