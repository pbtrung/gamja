import type { ReactNode } from "react";
import Nick from "../Nick";
import type { Context } from "./context";

export function makeNick(ctx: Context) {
	return function createNick(nick: string, key?: string | number) {
		return (
			<Nick
				key={key}
				nick={nick}
				serverID={ctx.buffer.server}
				bouncerNetwork={ctx.bouncerNetwork}
				onClick={ctx.onNickClick}
			/>
		);
	};
}

export function createNickList(
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
