import { memo, useRef, type MouseEvent } from "react";
import {
	Ban,
	EllipsisVertical,
	Info,
	LogOut,
	MessageSquare,
	Mic,
	MicOff,
	Shield,
	ShieldOff,
	UserX,
} from "lucide-react";
import * as irc from "../lib/irc";
import type { BouncerNetwork, MemberAction, User } from "../state";
import { getNickColorIndex, meaningfulRealname, nickInitial, sortMembers } from "../format";
import Membership from "./Membership";
import Menu, { type MenuHandle, type MenuItem } from "./Menu";

function memberActions(
	nick: string,
	membership: string,
	canModerate: boolean,
	onAction: (nick: string, action: MemberAction) => void,
): MenuItem[] {
	const item = (action: MemberAction, icon: MenuItem["icon"], label: string, danger = false) => ({
		key: action,
		icon,
		label,
		danger,
		onClick: () => onAction(nick, action),
	});
	const items = [item("message", MessageSquare, "Send message"), item("whois", Info, "Show info")];
	if (canModerate) {
		items.push(
			membership.includes("@")
				? item("deop", ShieldOff, "Remove operator")
				: item("op", Shield, "Make operator"),
			membership.includes("+")
				? item("devoice", MicOff, "Remove voice")
				: item("voice", Mic, "Give voice"),
			item("kick", LogOut, "Kick", true),
			item("ban", Ban, "Ban", true),
			item("kickban", UserX, "Kick and ban", true),
		);
	}
	return items;
}

interface MemberItemProps {
	nick: string;
	membership: string;
	user: User | undefined;
	bouncerNetwork: BouncerNetwork | null;
	canModerate: boolean;
	onClick: (nick: string) => void;
	onAction: (nick: string, action: MemberAction) => void;
}

const MemberItem = memo(function MemberItem({
	nick,
	membership,
	user,
	bouncerNetwork,
	canModerate,
	onClick,
	onAction,
}: MemberItemProps) {
	const menu = useRef<MenuHandle>(null);

	function handleClick(event: MouseEvent) {
		event.preventDefault();
		onClick(nick);
	}

	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();
		menu.current?.openAt(event.clientX, event.clientY);
	}

	const lines: string[] = [];
	const classes: string[] = [];
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
			<a
				href={url}
				className={classes.join(" ") || undefined}
				title={title}
				onClick={handleClick}
				onContextMenu={handleContextMenu}
			>
				<span className={`member-avatar nick-${getNickColorIndex(nick)}`} aria-hidden="true">
					{nickInitial(nick)}
					{user?.away && <span className="presence away" />}
				</span>
				<span className="member-nick">
					<Membership value={membership} />
					{nick}
				</span>
			</a>
			<Menu
				ref={menu}
				items={memberActions(nick, membership, canModerate, onAction)}
				label={`Actions for ${nick}`}
				toggleLabel={`Actions for ${nick}`}
				toggleIcon={EllipsisVertical}
				toggleClassName="btn btn-sm member-menu"
			/>
		</li>
	);
});

interface MemberListProps {
	members: irc.CaseMapMap<string>;
	users: irc.CaseMapMap<User>;
	prefixes?: string;
	bouncerNetwork: BouncerNetwork | null;
	/** Whether the user is a channel operator */
	canModerate: boolean;
	onNickClick: (nick: string) => void;
	onAction: (nick: string, action: MemberAction) => void;
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

function MemberList({
	members,
	users,
	prefixes,
	bouncerNetwork,
	canModerate,
	onNickClick,
	onAction,
}: MemberListProps) {
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
								canModerate={canModerate}
								onClick={onNickClick}
								onAction={onAction}
							/>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

export default memo(MemberList);
