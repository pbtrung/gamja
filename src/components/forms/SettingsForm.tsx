import type { FormEvent } from "react";
import { LogOut } from "lucide-react";
import { BufferEventsDisplayMode, type Settings } from "../../state";
import { registerProtocolHandler } from "../../format";

interface SettingsFormProps {
	settings: Settings;
	showProtocolHandler: boolean;
	onChange: (settings: Partial<Settings>) => void;
	onDisconnect: () => void;
	onClose: () => void;
}

export default function SettingsForm({
	settings,
	showProtocolHandler,
	onChange,
	onDisconnect,
	onClose,
}: SettingsFormProps) {
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
