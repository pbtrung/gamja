import { CornerUpRight } from "lucide-react";
import { parseCTCP, type Message } from "../../lib/irc";
import { getNickColorIndex } from "../../format";
import { strip as stripANSI } from "../../lib/ansi";
import { flash } from "../../lib/flash";

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

export default function ReplyQuote({
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
	const text = parseCTCP(parent)?.param ?? parent.params[1] ?? "";
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
