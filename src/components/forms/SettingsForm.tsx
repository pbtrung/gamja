import {
	useId,
	useState,
	type CSSProperties,
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import {
	Bell,
	Check,
	EllipsisVertical,
	LogOut,
	MessagesSquare,
	Palette,
	Settings as SettingsIcon,
	type LucideIcon,
} from "lucide-react";
import DialogActions from "./DialogActions";
import Dialog from "../Dialog";
import Menu from "../Menu";
import Switch from "./Switch";
import {
	BufferEventsDisplayMode,
	type MessageLayout,
	type NotificationLevel,
	type Settings,
} from "../../state";
import { registerProtocolHandler } from "../../format";
import { THEMES, type Theme } from "../../themes";

interface SettingsFormProps {
	settings: Settings;
	/** The section shown, kept by the form itself if not given */
	tab?: SettingsTab;
	onTabChange?: (tab: SettingsTab) => void;
	showProtocolHandler: boolean;
	/** Whether push notifications can be enabled */
	pushAvailable?: boolean;
	onPushChange?: (enabled: boolean) => Promise<void>;
	onChange: (settings: Partial<Settings>) => void;
	onDisconnect: () => void;
	onClose: () => void;
}

type SettingsTab = "appearance" | "messages" | "notifications";

const settingsTabs: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
	{ id: "appearance", label: "Appearance", icon: Palette },
	{ id: "messages", label: "Messages", icon: MessagesSquare },
	{ id: "notifications", label: "Notifications", icon: Bell },
];

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
			<Switch
				id={id + "-input"}
				name={name}
				checked={checked}
				disabled={disabled}
				aria-describedby={hint ? id + "-hint" : undefined}
				onChange={onChange}
			/>
		</div>
	);
}

interface SegmentedRowProps<T> {
	name: string;
	label: string;
	hint: string;
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
}

/** A setting with a label and a hint on the left and a few choices on the right */
function SegmentedRow<T extends string | number>({
	name,
	label,
	hint,
	options,
	value,
	onChange,
}: SegmentedRowProps<T>) {
	const id = useId();
	return (
		<div className="settings-row">
			<div className="settings-row-text">
				<span id={id + "-label"}>{label}</span>
				<span className="settings-row-hint" id={id + "-hint"}>
					{hint}
				</span>
			</div>
			<div
				className="segmented"
				role="radiogroup"
				aria-labelledby={id + "-label"}
				aria-describedby={id + "-hint"}
			>
				{options.map((option) => (
					<label
						key={option.value}
						className={"segmented-option" + (value === option.value ? " selected" : "")}
					>
						<input
							type="radio"
							name={name}
							value={option.value}
							checked={value === option.value}
							onChange={() => onChange(option.value)}
						/>
						{option.label}
					</label>
				))}
			</div>
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
	{
		value: "compact",
		label: "Compact",
		hint: "Classic IRC, one line per message",
	},
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

const notificationLevels: { value: NotificationLevel; label: string }[] = [
	{ value: "mentions", label: "Mentions" },
	{ value: "all", label: "All" },
	{ value: "none", label: "Off" },
];

const autoAwayDelays: { value: number; label: string }[] = [
	{ value: 0, label: "Never" },
	{ value: 1, label: "1 min" },
	{ value: 5, label: "5 min" },
	{ value: 15, label: "15 min" },
];

/** On phones: the sections in a menu behind a ⋮ button of the dialog header */
function SettingsMenu({ tab, onChange }: { tab: SettingsTab; onChange: (tab: SettingsTab) => void }) {
	return (
		<span className="settings-menu">
			<Menu
				items={settingsTabs.map(({ id, label, icon }) => ({
					key: id,
					label,
					icon,
					checked: tab === id,
					onClick: () => onChange(id),
				}))}
				label="Settings sections"
				toggleLabel="Settings sections"
				toggleIcon={EllipsisVertical}
				toggleClassName="icon-btn"
			/>
		</span>
	);
}

/** Settings, with the current section in the title and a menu of sections on phones */
export function SettingsDialog({
	onDismiss,
	children,
}: {
	onDismiss: () => void;
	children: (tab: SettingsTab, setTab: (tab: SettingsTab) => void) => ReactNode;
}) {
	const [tab, setTab] = useState<SettingsTab>("appearance");
	const current = settingsTabs.find((t) => t.id === tab)!;
	return (
		<Dialog
			title={
				<>
					Settings
					<span className="settings-current" aria-hidden="true">
						{" "}
						· {current.label}
					</span>
				</>
			}
			icon={SettingsIcon}
			actions={<SettingsMenu tab={tab} onChange={setTab} />}
			onDismiss={onDismiss}
			size="lg"
		>
			{children(tab, setTab)}
		</Dialog>
	);
}

export default function SettingsForm(props: SettingsFormProps) {
	const { settings, showProtocolHandler, pushAvailable, onPushChange, onChange, onDisconnect, onClose } =
		props;
	const id = useId();
	const [ownTab, setOwnTab] = useState<SettingsTab>("appearance");
	const tab = props.tab ?? ownTab;
	const setTab = props.onTabChange ?? setOwnTab;
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

	// Arrow keys, Home and End move between the tabs
	function handleTabKeyDown(event: KeyboardEvent<HTMLElement>) {
		const index = settingsTabs.findIndex((t) => t.id === tab);
		const moves: Record<string, number> = {
			ArrowDown: index + 1,
			ArrowRight: index + 1,
			ArrowUp: index - 1,
			ArrowLeft: index - 1,
			Home: 0,
			End: settingsTabs.length - 1,
		};
		if (!(event.key in moves)) {
			return;
		}
		event.preventDefault();
		const next = settingsTabs[(moves[event.key] + settingsTabs.length) % settingsTabs.length];
		setTab(next.id);
		document.getElementById(`${id}-tab-${next.id}`)?.focus();
	}

	let pane: ReactNode;
	switch (tab) {
		case "appearance":
			pane = (
				<>
					<fieldset className="settings-fieldset">
						<legend className="settings-heading">Theme</legend>
						<div className="theme-grid">
							{THEMES.map((theme) => (
								<label
									key={theme.id}
									className={
										"theme-option" + (settings.theme === theme.id ? " selected" : "")
									}
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

					<fieldset className="settings-fieldset">
						<legend className="settings-heading">Message layout</legend>
						<div className="layout-grid">
							{layouts.map(({ value, label, hint }) => (
								<label
									key={value}
									className={
										"layout-option" + (settings.layout === value ? " selected" : "")
									}
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
				</>
			);
			break;
		case "messages":
			pane = (
				<>
					<h3 className="settings-heading">Messages</h3>
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
						<SegmentedRow
							name="bufferEvents"
							label="Chat events"
							hint="Joins, parts, quits and nick changes"
							options={eventModes}
							value={settings.bufferEvents}
							onChange={(bufferEvents) => onChange({ bufferEvents })}
						/>
					</div>
				</>
			);
			break;
		case "notifications":
			pane = (
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
				</>
			);
			break;
	}

	return (
		<form className="settings-form" onSubmit={handleSubmit}>
			<div className="settings-layout">
				<nav
					className="settings-nav"
					role="tablist"
					aria-label="Settings sections"
					aria-orientation="vertical"
					onKeyDown={handleTabKeyDown}
				>
					{settingsTabs.map(({ id: tabID, label, icon: Icon }) => (
						<button
							key={tabID}
							id={`${id}-tab-${tabID}`}
							type="button"
							role="tab"
							title={label}
							aria-selected={tab === tabID}
							aria-controls={`${id}-pane`}
							tabIndex={tab === tabID ? 0 : -1}
							className={"settings-nav-item" + (tab === tabID ? " active" : "")}
							onClick={() => setTab(tabID)}
						>
							<Icon aria-hidden="true" />
							<span className="settings-nav-label">{label}</span>
						</button>
					))}
				</nav>
				<div
					id={`${id}-pane`}
					className="settings-pane"
					role="tabpanel"
					aria-labelledby={`${id}-tab-${tab}`}
				>
					{pane}
				</div>
			</div>

			<DialogActions label="Done">
				<button type="button" className="btn btn-danger-outline me-auto" onClick={onDisconnect}>
					<LogOut aria-hidden="true" /> Disconnect
				</button>
			</DialogActions>
		</form>
	);
}
