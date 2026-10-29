import { EllipsisVertical } from "lucide-react";
import useMediaQuery, { SMALL_SCREEN } from "./useMediaQuery";
import BufferTypeIcon from "./BufferTypeIcon";
import {
	BufferType,
	ServerStatus,
	getServerName,
	type Buffer,
	type BouncerNetwork,
	type Server,
	type TargetMetadata,
	type Unread,
	type User,
} from "../state";
import type { LinkClickHandler } from "./RichText";
import Menu from "./Menu";
import ActionButton from "./header/ActionButton";
import { BufferListToggle, MemberListToggle } from "./header/PanelToggles";
import { bufferActions, splitActions } from "./header/actions";
import { describeBuffer } from "./header/description";

export interface BufferHeaderProps {
	buffer: Buffer;
	server: Server;
	user: User | null;
	bouncerNetwork: BouncerNetwork | null;
	memberListHidden: boolean;
	/** Whether the side panels are open, on small screens */
	bufferListOpen: boolean;
	/** Buffer list hidden on large screens */
	bufferListHidden: boolean;
	memberListOpen: boolean;
	unreadElsewhere: Unread;
	onChannelClick: LinkClickHandler;
	onClose: () => void;
	/** Hide the channel without leaving it, on soju networks */
	onDetach?: () => void;
	/** Pin, mute or block the buffer, on soju networks */
	onSetMetadata?: (field: keyof TargetMetadata, value: boolean) => void;
	onJoin: () => void;
	onReconnect: () => void;
	onAddNetwork: () => void;
	onManageNetwork: () => void;
	onOpenSettings: () => void;
	/** Open message search, if supported */
	onSearch?: () => void;
	onOpenBufferList: () => void;
	onOpenMemberList: () => void;
}

export default function BufferHeader(props: BufferHeaderProps) {
	const { buffer, server, bouncerNetwork, user } = props;
	// Small screens only show the panel toggles and a menu with the rest
	const smallScreen = useMediaQuery(SMALL_SCREEN);

	let fullyConnected = server.status === ServerStatus.REGISTERED;
	if (bouncerNetwork) {
		fullyConnected = fullyConnected && bouncerNetwork.state === "connected";
	}

	const { content: description, title: descriptionTitle } = describeBuffer(
		buffer,
		server,
		user,
		bouncerNetwork,
		props.onChannelClick,
	);
	const actions = bufferActions(buffer, server, fullyConnected, props);
	const { menuActions, inlineActions } = splitActions(actions, buffer, smallScreen);

	let name = buffer.name;
	if (buffer.type === BufferType.SERVER) {
		name = getServerName(server, bouncerNetwork);
	}

	// Panel toggles are only shown on small screens (or when the member
	// list is hidden via settings)
	const bufferListToggle = (
		<BufferListToggle
			smallScreen={smallScreen}
			hidden={props.bufferListHidden}
			open={props.bufferListOpen}
			unreadElsewhere={props.unreadElsewhere}
			onClick={props.onOpenBufferList}
		/>
	);
	const memberListToggle =
		buffer.type === BufferType.CHANNEL ? (
			<MemberListToggle
				hidden={props.memberListHidden}
				open={props.memberListOpen}
				onClick={props.onOpenMemberList}
			/>
		) : null;

	// Small screens: [buffer list] [title and description] [menu] [member list]
	return (
		<>
			<div className="leading">{bufferListToggle}</div>
			<div className="title">
				<BufferTypeIcon type={buffer.type} className="title-icon" aria-hidden="true" />
				<h1 className="title-text" title={name}>
					{name}
				</h1>
			</div>
			{description ? (
				<div className="description" title={descriptionTitle}>
					{description}
				</div>
			) : null}
			<div className="actions">
				<div className="btn-group" role="group" aria-label="Buffer actions">
					{menuActions.length > 0 && (
						<Menu
							items={menuActions}
							label="Buffer actions"
							toggleLabel="More actions"
							toggleIcon={EllipsisVertical}
						/>
					)}
					{memberListToggle}
					{inlineActions.map(({ key, ...action }) => (
						<ActionButton key={key} {...action} iconOnly />
					))}
				</div>
			</div>
		</>
	);
}
