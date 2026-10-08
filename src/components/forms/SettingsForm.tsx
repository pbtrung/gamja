import { useId, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Bell, Check, LogOut, MessagesSquare, Palette } from "lucide-react";
import { BufferEventsDisplayMode, type MessageLayout, type Settings } from "../../state";
import { registerProtocolHandler } from "../../format";
import { THEMES, type Theme } from "../../themes";

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

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
	const id = useId();
	return (
		<section className="settings-section" aria-labelledby={id}>
			<h3 className="settings-heading" id={id}>
				{icon}
				{title}
			</h3>
			{children}
		</section>
	);
}

interface ToggleRowProps {
	name: string;
	label: string;
	hint?: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (checked: boolean) => void;
}

/** A setting with a label and a hint on the left and a switch on the right */
function ToggleRow({ name, label, hint, checked, disabled, onChange }: ToggleRowProps) {
	const id = useId();
	return (
		<div className="settings-row">
			<div className="settings-row-text">
				<label htmlFor={id + "-input"}>{label}</label>
				{hint && (
					<span className="settings-row-hint" id={id + "-hint"}>
						{hint}
					</span>
				)}
			</div>
			<input
				id={id + "-input"}
				className="switch"
				type="checkbox"
				name={name}
				checked={checked}
				disabled={disabled}
				aria-describedby={hint ? id + "-hint" : undefined}
				onChange={(e) => onChange(e.target.checked)}
			/>
		</div>
	);
}

function ThemePreview({ theme }: { theme: Theme }) {
	const [bg, fg, accent] = theme.swatch;
	const style = { "--sw-bg": bg, "--sw-fg": fg, "--sw-accent": accent } as CSSProperties;
	return (
		<span className={"theme-preview" + (theme.scheme === "system" ? " system" : "")} style={style}>
			<span className="theme-preview-sidebar">
				<span className="theme-preview-item active" />
				<span className="theme-preview-item" />
				<span className="theme-preview-item" />
			</span>
			<span className="theme-preview-chat">
				<span className="theme-preview-line" style={{ width: "70%" }} />
				<span className="theme-preview-line" style={{ width: "45%" }} />
				<span className="theme-preview-line accent" style={{ width: "55%" }} />
			</span>
		</span>
	);
}

const layouts: { value: MessageLayout; label: string; hint: string }[] = [
	{
		value: "comfortable",
		label: "Comfortable",
		hint: "Messages grouped under the sender's name and avatar",
	},
	{ value: "compact", label: "Compact", hint: "Classic IRC, one line per message" },
];

function LayoutPreview({ layout }: { layout: MessageLayout }) {
	if (layout === "comfortable") {
		return (
			<span className="layout-preview comfortable" aria-hidden="true">
				{[0, 1].map((i) => (
					<span className="layout-preview-group" key={i}>
						<span className="layout-preview-avatar" />
						<span className="layout-preview-lines">
							<span className="layout-preview-line name" />
							<span className="layout-preview-line" style={{ width: i ? "60%" : "85%" }} />
						</span>
					</span>
				))}
			</span>
		);
	}
	return (
		<span className="layout-preview compact" aria-hidden="true">
			{["80%", "60%", "90%", "50%"].map((width, i) => (
				<span className="layout-preview-row" key={i}>
					<span className="layout-preview-time" />
					<span className="layout-preview-line name" />
					<span className="layout-preview-line" style={{ width }} />
				</span>
			))}
		</span>
	);
}

const eventModes: { value: BufferEventsDisplayMode; label: string }[] = [
	{ value: BufferEventsDisplayMode.FOLD, label: "Fold" },
	{ value: BufferEventsDisplayMode.EXPAND, label: "Expand" },
	{ value: BufferEventsDisplayMode.HIDE, label: "Hide" },
];

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
	const eventsID = useId();

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

	return (
		<form className="settings-form" onSubmit={handleSubmit}>
			<Section icon={<Palette aria-hidden="true" />} title="Appearance">
				<fieldset className="settings-card settings-card-padded">
					<legend className="settings-label">Theme</legend>
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
								<ThemePreview theme={theme} />
								<span className="theme-name">
									<span>{theme.name}</span>
									{settings.theme === theme.id && <Check aria-hidden="true" />}
								</span>
							</label>
						))}
					</div>
				</fieldset>

				<fieldset className="settings-card settings-card-padded">
					<legend className="settings-label">Message layout</legend>
					<div className="layout-grid">
						{layouts.map(({ value, label, hint }) => (
							<label
								key={value}
								className={"layout-option" + (settings.layout === value ? " selected" : "")}
							>
								<input
									type="radio"
									name="layout"
									value={value}
									checked={settings.layout === value}
									onChange={() => onChange({ layout: value })}
								/>
								<LayoutPreview layout={value} />
								<span className="layout-text">
									<span className="layout-name">{label}</span>
									<span className="settings-row-hint">{hint}</span>
								</span>
							</label>
						))}
					</div>
				</fieldset>
			</Section>

			<Section icon={<MessagesSquare aria-hidden="true" />} title="Messages">
				<div className="settings-card">
					<ToggleRow
						name="secondsInTimestamps"
						label="Show seconds in time indicator"
						hint="Display timestamps as 12:34:56 instead of 12:34"
						checked={settings.secondsInTimestamps}
						onChange={(checked) => onChange({ secondsInTimestamps: checked })}
					/>
					<ToggleRow
						name="showMemberList"
						label="Show member list"
						hint="Keep the channel member list open on wide screens"
						checked={settings.showMemberList}
						onChange={(checked) => onChange({ showMemberList: checked })}
					/>
					<div className="settings-row">
						<div className="settings-row-text">
							<span id={eventsID + "-label"}>Chat events</span>
							<span className="settings-row-hint" id={eventsID + "-hint"}>
								Joins, parts, quits and nick changes
							</span>
						</div>
						<div
							className="segmented"
							role="radiogroup"
							aria-labelledby={eventsID + "-label"}
							aria-describedby={eventsID + "-hint"}
						>
							{eventModes.map(({ value, label }) => (
								<label
									key={value}
									className={
										"segmented-option" +
										(settings.bufferEvents === value ? " selected" : "")
									}
								>
									<input
										type="radio"
										name="bufferEvents"
										value={value}
										checked={settings.bufferEvents === value}
										onChange={() => onChange({ bufferEvents: value })}
									/>
									{label}
								</label>
							))}
						</div>
					</div>
				</div>
			</Section>

			{(pushAvailable || showProtocolHandler) && (
				<Section icon={<Bell aria-hidden="true" />} title="Notifications and links">
					<div className="settings-card">
						{pushAvailable && (
							<ToggleRow
								name="pushNotifications"
								label="Push notifications"
								hint="Get notified of mentions and messages while gamja is closed"
								checked={settings.pushNotifications}
								disabled={pushBusy}
								onChange={handlePushChange}
							/>
						)}
						{pushError && (
							<div className="settings-row">
								<div className="alert alert-danger" role="alert">
									{pushError}
								</div>
							</div>
						)}
						{showProtocolHandler && (
							<div className="settings-row">
								<div className="settings-row-text">
									<span>Default IRC client</span>
									<span className="settings-row-hint">Open irc:// links in gamja</span>
								</div>
								<button
									type="button"
									className="btn btn-sm"
									onClick={registerProtocolHandler}
								>
									Enable
								</button>
							</div>
						)}
					</div>
				</Section>
			)}

			<div className="dialog-actions settings-actions">
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
