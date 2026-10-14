import type { MouseEvent } from "react";
import * as irc from "../lib/irc";
import type { BouncerNetwork } from "../state";
import { useAppState } from "../app/context";
import { getNickColorIndex, meaningfulRealname } from "../format";

interface NickProps {
	nick: string;
	/** Server the user is on, to look it up */
	serverID: number;
	bouncerNetwork?: BouncerNetwork | null;
	onClick?: (nick: string) => void;
}

export default function Nick({ nick, serverID, bouncerNetwork, onClick }: NickProps) {
	// Only select the real name, other user updates don't affect nicks
	const title =
		useAppState((s) => meaningfulRealname(s.servers.get(serverID)?.users.get(nick), nick)) ?? undefined;

	function handleClick(event: MouseEvent) {
		event.preventDefault();
		onClick?.(nick);
	}

	const url = irc.formatURL({ host: bouncerNetwork?.host ?? undefined, entity: nick, enttype: "user" });
	return (
		<a href={url} title={title} className={`nick nick-${getNickColorIndex(nick)}`} onClick={handleClick}>
			{nick}
		</a>
	);
}
