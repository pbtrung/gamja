import { getNickColorIndex, nickInitial } from "../../format";
import { useAppState } from "../../app/context";

/** Tagged as a bot by the message itself or by WHO replies */
export function BotBadge({ serverID, nick, tagged }: { serverID: number; nick: string; tagged: boolean }) {
	const isBot = useAppState((s) => Boolean(s.servers.get(serverID)?.users.get(nick)?.bot));
	return tagged || isBot ? <span className="tag-badge">bot</span> : null;
}

export function Avatar({ nick }: { nick: string }) {
	return (
		<span className={`avatar nick-${getNickColorIndex(nick)}`} aria-hidden="true">
			{nickInitial(nick)}
		</span>
	);
}
