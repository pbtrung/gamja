import type { MouseEvent } from "react";
import * as irc from "../lib/irc";
import type { BouncerNetwork } from "../state";
import { useAppState } from "../app/context";
import { getNickColorIndex } from "../format";

interface NickProps {
	nick: string;
	/** Limit the displayed characters, keeping the full nick for actions. */
	maxLength?: number;
	/** user@host from the message, if known */
	host?: string;
	/** Server the user is on, to look it up */
	serverID: number;
	bouncerNetwork?: BouncerNetwork | null;
	onClick?: (nick: string) => void;
}

export default function Nick({ nick, maxLength, host, serverID, bouncerNetwork, onClick }: NickProps) {
	// Select the tooltip text, so unrelated user updates don't re-render nicks.
	const title = useAppState((s) => {
		const user = s.servers.get(serverID)?.users.get(nick);
		const mask = host ?? (user?.username && user.hostname ? `${user.username}@${user.hostname}` : "");
		const characters = Array.from(mask ? `${nick}\n${mask}` : nick);
		return characters.length > 80 ? characters.slice(0, 79).join("") + "…" : characters.join("");
	});
	const displayNick = maxLength === undefined ? nick : Array.from(nick).slice(0, maxLength).join("");
	const truncated = displayNick !== nick;

	function handleClick(event: MouseEvent) {
		event.preventDefault();
		onClick?.(nick);
	}

	const url = irc.formatURL({ host: bouncerNetwork?.host ?? undefined, entity: nick, enttype: "user" });
	return (
		<a
			href={url}
			title={title}
			aria-label={truncated ? nick : undefined}
			className={`nick nick-${getNickColorIndex(nick)}`}
			onClick={handleClick}
		>
			{displayNick}
		</a>
	);
}
