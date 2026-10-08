import { memo, type MouseEvent } from "react";
import { strip as stripANSI } from "../lib/ansi";
import * as irc from "../lib/irc";
import type { BouncerNetwork, User } from "../state";
import { getNickColorIndex, sortMembers } from "../format";
import Membership from "./Membership";

interface MemberItemProps {
	nick: string;
	membership: string;
	user: User | undefined;
	bouncerNetwork: BouncerNetwork | null;
	onClick: (nick: string) => void;
}

const MemberItem = memo(function MemberItem({
	nick,
	membership,
	user,
	bouncerNetwork,
	onClick,
}: MemberItemProps) {
	function handleClick(event: MouseEvent) {
		event.preventDefault();
		onClick(nick);
	}

	let title: string | undefined;
	const classes = ["nick"];
	if (user) {
		let mask = "";
		if (user.username && user.hostname) {
			mask = `${user.username}@${user.hostname}`;
		}

		if (irc.isMeaningfulRealname(user.realname, nick)) {
			title = stripANSI(user.realname!);
			if (mask) {
				title = `${title} (${mask})`;
			}
		} else {
			title = mask;
		}

		if (user.account) {
			title += `\nAuthenticated as ${user.account}`;
		}

		if (user.away) {
			classes.push("away");
			title += "\nAway";
		}
	}

	const url = irc.formatURL({
		host: bouncerNetwork?.host ?? undefined,
		entity: nick,
		enttype: "user",
	});

	return (
		<li>
			<a href={url} className={classes.join(" ")} title={title} onClick={handleClick}>
				<span className={`member-avatar nick-${getNickColorIndex(nick)}`} aria-hidden="true">
					{nick.charAt(0)}
					{user?.away && <span className="presence away" />}
				</span>
				<span className="member-nick">
					<Membership value={membership} />
					{nick}
				</span>
			</a>
		</li>
	);
});

interface MemberListProps {
	members: irc.CaseMapMap<string>;
	users: irc.CaseMapMap<User>;
	prefixes?: string;
	bouncerNetwork: BouncerNetwork | null;
	onNickClick: (nick: string) => void;
}

const ROLE_TITLES: Record<string, string> = {
	owner: "Owners",
	admin: "Admins",
	operator: "Operators",
	halfop: "Half-operators",
	voice: "Voiced",
};

/** Split sorted members into sections by their highest membership. */
function groupMembers(sorted: [string, string][]): { title: string; members: [string, string][] }[] {
	const groups: { title: string; members: [string, string][] }[] = [];
	for (const member of sorted) {
		const role = irc.STD_MEMBERSHIP_NAMES[member[1][0]];
		const title = (role && ROLE_TITLES[role]) || "Members";
		let group = groups[groups.length - 1];
		if (!group || group.title !== title) {
			group = { title, members: [] };
			groups.push(group);
		}
		group.members.push(member);
	}
	return groups;
}

function MemberList({ members, users, prefixes, bouncerNetwork, onNickClick }: MemberListProps) {
	const groups = groupMembers(sortMembers(members, prefixes));
	return (
		<div className="member-items">
			{groups.map((group) => (
				<section
					key={group.title}
					className="member-group"
					aria-label={`${group.title}, ${group.members.length}`}
				>
					<h3 className="member-group-title">
						{group.title} — {group.members.length}
					</h3>
					<ul>
						{group.members.map(([nick, membership]) => (
							<MemberItem
								key={nick}
								nick={nick}
								membership={membership}
								user={users.get(nick)}
								bouncerNetwork={bouncerNetwork}
								onClick={onNickClick}
							/>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

export default memo(MemberList);
