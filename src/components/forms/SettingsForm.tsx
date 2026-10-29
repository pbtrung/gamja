import { useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { EllipsisVertical, LogOut, Settings as SettingsIcon } from "lucide-react";
import DialogActions from "./DialogActions";
import Dialog from "../Dialog";
import Menu from "../Menu";
import type { Settings } from "../../state";
import AppearancePane from "./settings/AppearancePane";
import FontPane from "./settings/FontPane";
import MessagesPane from "./settings/MessagesPane";
import NotificationsPane from "./settings/NotificationsPane";
import AboutPane from "./settings/AboutPane";
import { settingsTabs, type SettingsTab } from "./settings/options";

interface SettingsFormProps {
	settings: Settings;
	bufferListUnreadOnly?: boolean;
	onBufferListUnreadOnlyChange?: (enabled: boolean) => void;
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
		case "about":
			pane = <AboutPane />;
			break;
		case "appearance":
			pane = <AppearancePane settings={settings} onChange={onChange} />;
			break;
		case "font":
			pane = <FontPane settings={settings} onChange={onChange} />;
			break;
		case "messages":
			pane = (
				<MessagesPane
					settings={settings}
					onChange={onChange}
					bufferListUnreadOnly={props.bufferListUnreadOnly}
					onBufferListUnreadOnlyChange={props.onBufferListUnreadOnlyChange}
				/>
			);
			break;
		case "notifications":
			pane = (
				<NotificationsPane
					settings={settings}
					onChange={onChange}
					pushAvailable={pushAvailable}
					pushBusy={pushBusy}
					pushError={pushError}
					onPushChange={handlePushChange}
					showProtocolHandler={showProtocolHandler}
				/>
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
