import { Menu as MenuIcon, PanelLeft, Users } from "lucide-react";
import { unreadLabel } from "../../format";
import { Unread } from "../../state";
import ActionButton from "./ActionButton";

interface BufferListToggleProps {
	smallScreen: boolean;
	/** Buffer list hidden on large screens */
	hidden: boolean;
	open: boolean;
	unreadElsewhere: Unread;
	onClick: () => void;
}

export function BufferListToggle({
	smallScreen,
	hidden,
	open,
	unreadElsewhere,
	onClick,
}: BufferListToggleProps) {
	return (
		<ActionButton
			// A drawer toggle on small screens, where the buffer list slides in
			icon={smallScreen || hidden ? MenuIcon : PanelLeft}
			label="Open buffer list"
			iconOnly
			className="buffer-list-toggle"
			description={unreadLabel(unreadElsewhere) ?? undefined}
			expanded={open}
			controls="buffer-list"
			onClick={onClick}
		>
			{unreadElsewhere !== Unread.NONE ? (
				<span className={`unread-indicator unread-${unreadElsewhere}`} aria-hidden="true" />
			) : null}
		</ActionButton>
	);
}

interface MemberListToggleProps {
	/** Member list hidden via settings, the toggle is then always shown */
	hidden: boolean;
	open: boolean;
	onClick: () => void;
}

export function MemberListToggle({ hidden, open, onClick }: MemberListToggleProps) {
	return (
		<ActionButton
			icon={Users}
			label="Open member list"
			iconOnly
			className={"member-list-toggle" + (hidden ? " always" : "")}
			expanded={open}
			controls="member-list"
			onClick={onClick}
		/>
	);
}
