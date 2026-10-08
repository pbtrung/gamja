import type { MouseEvent } from "react";
import * as irc from "../lib/irc";
import type { BouncerNetwork, User } from "../state";
import { getNickColorIndex, meaningfulRealname } from "../format";

interface NickProps {
	nick: string;
	user?: User;
	bouncerNetwork?: BouncerNetwork | null;
	onClick?: (nick: string) => void;
}

export default function Nick({ nick, user, bouncerNetwork, onClick }: NickProps) {
	function handleClick(event: MouseEvent) {
		event.preventDefault();
		onClick?.(nick);
	}

	const title = meaningfulRealname(user, nick) ?? undefined;

	const url = irc.formatURL({ host: bouncerNetwork?.host ?? undefined, entity: nick, enttype: "user" });
	return (
		<a href={url} title={title} className={`nick nick-${getNickColorIndex(nick)}`} onClick={handleClick}>
			{nick}
		</a>
	);
}
