import { Moon, Pencil, Sun } from "lucide-react";
import { getNickColorIndex, nickInitial } from "../format";
import Menu, { type MenuItem } from "./Menu";

interface SelfStatusProps {
	nick: string;
	awayMessage: string | null;
	onSetAway: () => void;
	onBack: () => void;
}

/** The user's nick and away status, with a menu to change it. */
export default function SelfStatus({ nick, awayMessage, onSetAway, onBack }: SelfStatusProps) {
	const away = awayMessage !== null;
	const items: MenuItem[] = away
		? [
				{ key: "back", icon: Sun, label: "Set as back", onClick: onBack },
				{ key: "edit", icon: Pencil, label: "Change away message…", onClick: onSetAway },
			]
		: [{ key: "away", icon: Moon, label: "Set away…", onClick: onSetAway }];
	const status = away ? `Away: ${awayMessage}` : "Online";

	return (
		<div className="self-status">
			<Menu
				items={items}
				label="Status"
				toggleLabel={`${nick}, ${status}. Change status`}
				toggleClassName="self-status-toggle"
				placement="above-start"
			>
				<span className={`member-avatar nick-${getNickColorIndex(nick)}`} aria-hidden="true">
					{nickInitial(nick)}
					<span className={"presence " + (away ? "away" : "here")} />
				</span>
				<span className="self-status-text" aria-hidden="true">
					<span className="self-status-nick">{nick}</span>
					<span className="self-status-away">{status}</span>
				</span>
			</Menu>
		</div>
	);
}
