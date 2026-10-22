import Alert from "../../Alert";
import { registerProtocolHandler } from "../../../format";
import type { Settings } from "../../../state";
import { autoAwayDelays, notificationLevels } from "./options";
import { SegmentedRow, ToggleRow } from "./rows";

interface NotificationsPaneProps {
	settings: Settings;
	onChange: (settings: Partial<Settings>) => void;
	pushAvailable?: boolean;
	/** Whether push notifications are being turned on or off */
	pushBusy: boolean;
	pushError: string | null;
	onPushChange: (enabled: boolean) => void;
	showProtocolHandler?: boolean;
}

/** The Notifications tab: notifications, auto-away and the protocol handler */
export default function NotificationsPane({
	settings,
	onChange,
	pushAvailable,
	pushBusy,
	pushError,
	onPushChange,
	showProtocolHandler,
}: NotificationsPaneProps) {
	return (
		<>
			<h3 className="settings-heading">Notifications and presence</h3>
			<div className="settings-card">
				<SegmentedRow
					name="notifications"
					label="Desktop notifications"
					hint="Messages that show a notification while gamja is open"
					options={notificationLevels}
					value={settings.notifications}
					onChange={(notifications) => onChange({ notifications })}
				/>
				<SegmentedRow
					name="autoAwayMinutes"
					label="Away in the background"
					hint="Appear away while gamja stays hidden"
					options={autoAwayDelays}
					value={settings.autoAwayMinutes}
					onChange={(autoAwayMinutes) => onChange({ autoAwayMinutes })}
				/>
				{pushAvailable && (
					<ToggleRow
						name="pushNotifications"
						label="Push notifications"
						hint="Get notified of mentions and messages while gamja is closed"
						checked={settings.pushNotifications}
						disabled={pushBusy}
						onChange={onPushChange}
					/>
				)}
				{pushError && (
					<div className="settings-row">
						<Alert>{pushError}</Alert>
					</div>
				)}
				{showProtocolHandler && (
					<div className="settings-row">
						<div className="settings-row-text">
							<span>Default IRC client</span>
							<span className="settings-row-hint">Open irc:// links in gamja</span>
						</div>
						<button type="button" className="btn btn-sm" onClick={registerProtocolHandler}>
							Enable
						</button>
					</div>
				)}
			</div>
		</>
	);
}
