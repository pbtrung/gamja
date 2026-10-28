import { memo, useCallback, useRef, useState, type MouseEvent } from "react";
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
	X,
} from "lucide-react";
import * as irc from "../lib/irc";
import type { BouncerNetwork, MemberAction, User } from "../state";
import { getNickColorIndex, meaningfulRealname, nickInitial, sortMembers } from "../format";
import Membership from "./Membership";
import IconButton from "./IconButton";
import FilterInput from "./FilterInput";
import Menu, { type MenuHandle, type MenuItem } from "./Menu";
import useMediaQuery from "./useMediaQuery";

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

/** Open the actions of a member, at the pointer or next to the opener */
type MenuOpener = (nick: string, event: MouseEvent<HTMLElement>, atPointer: boolean) => void;

interface MemberItemProps {
	nick: string;
	membership: string;
	user: User | undefined;
	bouncerNetwork: BouncerNetwork | null;
	/** Whether tapping the nick opens its actions */
	tapForActions: boolean;
	/** Whether the actions menu is open for this member */
	menuOpen: boolean;
	onClick: (nick: string) => void;
	onMenu: MenuOpener;
}

const MemberItem = memo(function MemberItem({
	nick,
	membership,
	user,
	bouncerNetwork,
	tapForActions,
	menuOpen,
	onClick,
	onMenu,
}: MemberItemProps) {
	function handleClick(event: MouseEvent<HTMLElement>) {
		event.preventDefault();
		if (tapForActions) {
			onMenu(nick, event, true);
		} else {
			onClick(nick);
		}
	}

	function handleContextMenu(event: MouseEvent<HTMLElement>) {
		event.preventDefault();
		onMenu(nick, event, true);
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
			<IconButton
				icon={EllipsisVertical}
				label={`Actions for ${nick}`}
				className="member-menu"
				hasPopup="menu"
				expanded={menuOpen}
				onClick={(event) => onMenu(nick, event, false)}
			/>
		</li>
	);
});

interface MemberListProps {
	onClose?: () => void;
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
	onClose,
	members,
	users,
	prefixes,
	bouncerNetwork,
	canModerate,
	onNickClick,
	onAction,
}: MemberListProps) {
	// Members share one menu, rather than mounting one each
	const menu = useRef<MenuHandle>(null);
	const [menuNick, setMenuNick] = useState<string | null>(null);
	// Read by the stable handlers below
	const menuNickRef = useRef<string | null>(null);
	// Touch screens have no room for a button per nick: tapping opens the
	// actions instead, which start with sending a message
	const tapForActions = useMediaQuery("(hover: none)");

	const handleMenu = useCallback<MenuOpener>((nick, event, atPointer) => {
		const opener = event.currentTarget;
		if (!atPointer && menuNickRef.current === nick) {
			// The toggle again
			menu.current?.close();
			return;
		}
		menuNickRef.current = nick;
		setMenuNick(nick);
		if (atPointer) {
			menu.current?.openAt(event.clientX, event.clientY, opener);
		} else {
			menu.current?.openFrom(opener, event.detail === 0);
		}
	}, []);
	const handleMenuClose = useCallback(() => {
		menuNickRef.current = null;
		setMenuNick(null);
	}, []);

	const [filter, setFilter] = useState("");
	const query = filter.trim().toLowerCase();
	const groups = groupMembers(
		sortMembers(members, prefixes).filter(([nick]) => nick.toLowerCase().includes(query)),
	);
	return (
		<>
			<header id="member-list-header">
				<FilterInput
					value={filter}
					onChange={setFilter}
					label="Filter users"
					placeholder={`Filter ${members.size} ${members.size === 1 ? "user" : "users"}`}
				/>
				{onClose && (
					<IconButton
						icon={X}
						label="Close member list"
						className="panel-close"
						onClick={onClose}
					/>
				)}
			</header>
			<div className="member-items">
				{groups.map((group) => (
					<section
						key={group.title}
						className="member-group"
						aria-label={`${group.title}, ${group.members.length}`}
					>
						<h3 className="member-group-title">
							{group.title}
							<span className="member-group-count">{group.members.length}</span>
						</h3>
						<ul>
							{group.members.map(([nick, membership]) => (
								<MemberItem
									key={nick}
									nick={nick}
									membership={membership}
									user={users.get(nick)}
									bouncerNetwork={bouncerNetwork}
									tapForActions={tapForActions}
									menuOpen={menuNick === nick}
									onClick={onNickClick}
									onMenu={handleMenu}
								/>
							))}
						</ul>
					</section>
				))}
				{groups.length === 0 && <p className="filter-empty">No user matches the filter.</p>}
				<Menu
					ref={menu}
					items={
						menuNick !== null
							? memberActions(menuNick, members.get(menuNick) ?? "", canModerate, onAction)
							: []
					}
					label={`Actions for ${menuNick}`}
					onClose={handleMenuClose}
				/>
			</div>
		</>
	);
}

export default memo(MemberList);
