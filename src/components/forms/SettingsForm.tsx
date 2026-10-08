import { useState, type FormEvent } from "react";
import { LogOut } from "lucide-react";
import { BufferEventsDisplayMode, type Settings } from "../../state";
import { registerProtocolHandler } from "../../format";
import { THEMES } from "../../themes";

interface SettingsFormProps {
	settings: Settings;
	showProtocolHandler: boolean;
	/** Whether push notifications can be enabled */
	pushAvailable?: boolean;
	onPushChange?: (enabled: boolean) => Promise<void>;
	onChange: (settings: Partial<Settings>) => void;
	onDisconnect: () => void;
	onClose: () => void;
}

export default function SettingsForm({
	settings,
	showProtocolHandler,
	pushAvailable,
	onPushChange,
	onChange,
	onDisconnect,
	onClose,
}: SettingsFormProps) {
	const [pushBusy, setPushBusy] = useState(false);
	const [pushError, setPushError] = useState<string | null>(null);

	async function handlePushChange(enabled: boolean) {
		if (!onPushChange) {
			return;
		}
		setPushBusy(true);
		setPushError(null);
		try {
			await onPushChange(enabled);
		} catch (err) {
			setPushError(err instanceof Error ? err.message : String(err));
		} finally {
			setPushBusy(false);
		}
	}

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		onClose();
	}

	const eventModes: [BufferEventsDisplayMode, string][] = [
		[BufferEventsDisplayMode.FOLD, "Show and fold chat events"],
		[BufferEventsDisplayMode.EXPAND, "Show and expand chat events"],
		[BufferEventsDisplayMode.HIDE, "Hide chat events"],
	];

	return (
		<form onSubmit={handleSubmit}>
			<fieldset className="settings-section">
				<legend className="settings-heading">Theme</legend>
				<div className="theme-grid">
					{THEMES.map((theme) => (
						<label
							key={theme.id}
							className={"theme-option" + (settings.theme === theme.id ? " selected" : "")}
						>
							<input
								type="radio"
								name="theme"
								value={theme.id}
								checked={settings.theme === theme.id}
								onChange={() => onChange({ theme: theme.id })}
							/>
							<span
								className={"theme-swatch" + (theme.scheme === "system" ? " system" : "")}
								style={{ backgroundColor: theme.swatch[0], color: theme.swatch[1] }}
								aria-hidden="true"
							>
								<span className="theme-swatch-text">Aa</span>
								<span
									className="theme-swatch-accent"
									style={{ backgroundColor: theme.swatch[2] }}
								/>
							</span>
							<span className="theme-name">{theme.name}</span>
						</label>
					))}
				</div>
			</fieldset>

			<fieldset className="settings-section">
				<legend className="settings-heading">Message layout</legend>
				<label className="check">
					<input
						type="radio"
						name="layout"
						value="comfortable"
						checked={settings.layout === "comfortable"}
						onChange={() => onChange({ layout: "comfortable" })}
					/>
					<span>
						Comfortable
						<span className="check-hint">Group messages under the sender's name and avatar</span>
					</span>
				</label>
				<label className="check">
					<input
						type="radio"
						name="layout"
						value="compact"
						checked={settings.layout === "compact"}
						onChange={() => onChange({ layout: "compact" })}
					/>
					<span>
						Compact
						<span className="check-hint">Classic IRC, one line per message</span>
					</span>
				</label>
			</fieldset>

			<fieldset className="settings-section">
				<legend className="settings-heading">Display</legend>
				<label className="check">
					<input
						type="checkbox"
						name="secondsInTimestamps"
						checked={settings.secondsInTimestamps}
						onChange={(e) => onChange({ secondsInTimestamps: e.target.checked })}
					/>
					<span>Show seconds in time indicator</span>
				</label>
				<label className="check">
					<input
						type="checkbox"
						name="showMemberList"
						checked={settings.showMemberList}
						onChange={(e) => onChange({ showMemberList: e.target.checked })}
					/>
					<span>Show member list</span>
				</label>
			</fieldset>

			<fieldset className="settings-section">
				<legend className="settings-heading">Chat events</legend>
				{eventModes.map(([mode, label]) => (
					<label className="check" key={mode}>
						<input
							type="radio"
							name="bufferEvents"
							value={mode}
							checked={settings.bufferEvents === mode}
							onChange={() => onChange({ bufferEvents: mode })}
						/>
						<span>{label}</span>
					</label>
				))}
			</fieldset>

			{pushAvailable && (
				<fieldset className="settings-section">
					<legend className="settings-heading">Notifications</legend>
					<label className="check">
						<input
							type="checkbox"
							name="pushNotifications"
							checked={settings.pushNotifications}
							disabled={pushBusy}
							onChange={(e) => handlePushChange(e.target.checked)}
						/>
						<span>
							Push notifications
							<span className="check-hint">
								Get notified of mentions and messages while gamja is closed
							</span>
						</span>
					</label>
					{pushError && (
						<div className="alert alert-danger" role="alert">
							{pushError}
						</div>
					)}
				</fieldset>
			)}

			{showProtocolHandler && (
				<div className="callout protocol-handler">
					<div>
						Set gamja as your default IRC client for this browser. IRC links will be automatically
						opened here.
					</div>
					<button type="button" className="btn btn-sm" onClick={registerProtocolHandler}>
						Enable
					</button>
				</div>
			)}

			<div className="dialog-actions">
				<button type="button" className="btn btn-danger-outline me-auto" onClick={onDisconnect}>
					<LogOut aria-hidden="true" /> Disconnect
				</button>
				<button type="submit" className="btn btn-primary">
					Done
				</button>
			</div>
		</form>
	);
}
