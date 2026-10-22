import type { ReactNode } from "react";
import * as irc from "../../lib/irc";
import type { Message } from "../../lib/irc";
import { BufferType } from "../../state";
import type { Context } from "./context";

const MODE_DESCRIPTIONS: Record<string, [string, string]> = {
	i: ["marked the channel as invite-only", "unmarked the channel as invite-only"],
	m: ["marked the channel as moderated", "unmarked the channel as moderated"],
	s: ["marked the channel as secret", "unmarked the channel as secret"],
	t: ["locked the channel topic", "unlocked the channel topic"],
	n: ["denied external messages to this channel", "allowed external messages to this channel"],
};

export function describeMode(msg: Message, ctx: Context, createNick: (nick: string) => ReactNode): ReactNode {
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
