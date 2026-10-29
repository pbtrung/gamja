import { useCallback } from "react";
import type { BouncerNetwork, Buffer, MemberAction, Server } from "../../state";
import { useController } from "../../app/context";
import * as store from "../../store";
import MemberList from "../MemberList";
import PaneResizer from "../PaneResizer";

interface MemberSidebarProps {
	buffer: Buffer;
	server: Server;
	bouncerNetwork: BouncerNetwork | null;
	/** "expand" when open on small screens, "hidden" when hidden via settings */
	className: string;
	smallScreen: boolean;
	canModerate: boolean;
}

/** The member list of a channel, a drawer on small screens */
export default function MemberSidebar({
	buffer,
	server,
	bouncerNetwork,
	className,
	smallScreen,
	canModerate,
}: MemberSidebarProps) {
	const app = useController();

	// Stable, so that the memoized member list doesn't re-render on every message
	const handleMemberClick = useCallback(
		(nick: string) => {
			app.open(nick);
			app.setOpenPanel("memberList", false);
		},
		[app],
	);
	const handleMemberAction = useCallback(
		(nick: string, action: MemberAction) => app.handleMemberAction(nick, action),
		[app],
	);

	return (
		<aside id="member-list" className={className} aria-label="Members list">
			{!smallScreen && (
				<PaneResizer
					side="right"
					label="Resize the member list"
					controls="member-list"
					cssVariable="--member-list-custom-width"
					item={store.memberListWidth}
				/>
			)}
			<div className="member-list-panel">
				<MemberList
					members={buffer.members}
					users={server.users}
					prefixes={server.membershipModes?.map((m) => m.prefix).join("")}
					bouncerNetwork={bouncerNetwork}
					canModerate={canModerate}
					onNickClick={handleMemberClick}
					onAction={handleMemberAction}
				/>
			</div>
		</aside>
	);
}
