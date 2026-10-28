import {
	BACKLOG_SIZE_MAX,
	BACKLOG_SIZE_MIN,
	MESSAGE_TEXT_SIZE_MAX,
	MESSAGE_TEXT_SIZE_MIN,
	backlogSize,
	messageTextSize,
	type Settings,
} from "../../../state";
import { eventModes } from "./options";
import { NumberRow, SegmentedRow, ToggleRow } from "./rows";

interface PaneProps {
	settings: Settings;
	onChange: (settings: Partial<Settings>) => void;
}

/** The Messages tab: timestamps, chat events, backlog and typing */
export default function MessagesPane({ settings, onChange }: PaneProps) {
	return (
		<>
			<h3 className="settings-heading">Messages</h3>
			<div className="settings-card">
				<NumberRow
					name="messageTextSize"
					label="Text size"
					hint="Buffer text in pixels (10–20 px)"
					min={MESSAGE_TEXT_SIZE_MIN}
					max={MESSAGE_TEXT_SIZE_MAX}
					value={messageTextSize(settings)}
					onChange={(messageTextSize) => onChange({ messageTextSize })}
				/>
				<ToggleRow
					name="secondsInTimestamps"
					label="Show seconds in time indicator"
					hint="Display timestamps as 12:34:56 instead of 12:34"
					checked={settings.secondsInTimestamps}
					onChange={(checked) => onChange({ secondsInTimestamps: checked })}
				/>
				<ToggleRow
					name="clock12h"
					label="12-hour clock"
					hint="Display timestamps as 01:34 PM instead of 13:34"
					checked={settings.clock12h}
					onChange={(clock12h) => onChange({ clock12h })}
				/>
				<ToggleRow
					name="showMemberList"
					label="Show member list"
					hint="Keep the channel member list open on wide screens"
					checked={settings.showMemberList}
					onChange={(checked) => onChange({ showMemberList: checked })}
				/>
				<SegmentedRow
					name="bufferEvents"
					label="Chat events"
					hint="Joins, parts, quits and nick changes"
					options={eventModes}
					value={settings.bufferEvents}
					onChange={(bufferEvents) => onChange({ bufferEvents })}
				/>
				<NumberRow
					name="backlogSize"
					label="Missed messages to load on connect"
					hint="Per buffer, the latest ones: older ones load on demand"
					min={BACKLOG_SIZE_MIN}
					max={BACKLOG_SIZE_MAX}
					value={backlogSize(settings)}
					onChange={(backlogSize) => onChange({ backlogSize })}
				/>
			</div>

			<h3 className="settings-heading">Typing</h3>
			<div className="settings-card">
				<ToggleRow
					name="showTyping"
					label="Show who is typing"
					hint="Below the composer, when the server supports it"
					checked={settings.showTyping}
					onChange={(showTyping) => onChange({ showTyping })}
				/>
				<ToggleRow
					name="sendTyping"
					label="Share when you're typing"
					hint="Let others see that you're typing a message"
					checked={settings.sendTyping}
					onChange={(sendTyping) => onChange({ sendTyping })}
				/>
			</div>
		</>
	);
}
