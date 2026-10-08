import { memo, type MouseEvent } from "react";
import * as irc from "../lib/irc";
import type { BouncerNetwork, User } from "../state";
import { getNickColorIndex, meaningfulRealname, nickInitial, sortMembers } from "../format";
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

	const lines: string[] = [];
	const classes = ["nick"];
	if (user) {
		const mask = user.username && user.hostname ? `${user.username}@${user.hostname}` : "";
		const realname = meaningfulRealname(user, nick);
		if (realname) {
			lines.push(mask ? `${realname} (${mask})` : realname);
		} else if (mask) {
			lines.push(mask);
		}
		if (user.account) {
			lines.push(`Authenticated as ${user.account}`);
		}
		if (user.away) {
			classes.push("away");
			lines.push("Away");
		}
	}
	const title = lines.length > 0 ? lines.join("\n") : undefined;

	const url = irc.formatURL({
		host: bouncerNetwork?.host ?? undefined,
		entity: nick,
		enttype: "user",
	});

	return (
		<li>
			<a href={url} className={classes.join(" ")} title={title} onClick={handleClick}>
				<span className={`member-avatar nick-${getNickColorIndex(nick)}`} aria-hidden="true">
					{nickInitial(nick)}
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
	// Non-standard prefixes share the "Members" section, which mustn't appear
	// twice even if they don't sort next to regular members
	const groups = new Map<string, [string, string][]>();
	for (const member of sorted) {
		const role = irc.STD_MEMBERSHIP_NAMES[member[1][0]];
		const title = (role && ROLE_TITLES[role]) || "Members";
		const group = groups.get(title) ?? [];
		group.push(member);
		groups.set(title, group);
	}
	return [...groups].map(([title, members]) => ({ title, members }));
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
