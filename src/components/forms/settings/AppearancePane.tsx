import { Check } from "lucide-react";
import type { Settings } from "../../../state";
import { THEMES } from "../../../themes";
import { layouts, nickAligns, nickColumnWidths } from "./options";
import { LayoutPreview, ThemePreview } from "./previews";
import { SegmentedRow, ToggleRow } from "./rows";

interface PaneProps {
	settings: Settings;
	onChange: (settings: Partial<Settings>) => void;
}

/** The Appearance tab: theme, message layout, text and nicks */
export default function AppearancePane({ settings, onChange }: PaneProps) {
	return (
		<>
			<fieldset className="settings-fieldset">
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

			<h3 className="settings-heading">Message lines</h3>
			<div className="settings-card">
				<ToggleRow
					name="showTimestamps"
					label="Show timestamps"
					hint="The time of each message, in all layouts"
					checked={settings.showTimestamps}
					onChange={(showTimestamps) => onChange({ showTimestamps })}
				/>
				<ToggleRow
					name="dateSeparators"
					label="Day separators"
					hint="A line with the date between messages of different days"
					checked={settings.dateSeparators}
					onChange={(dateSeparators) => onChange({ dateSeparators })}
				/>
				{settings.layout === "compact" && (
					<ToggleRow
						name="indentWrapped"
						label="Indent wrapped lines"
						hint="Long messages continue further in than their first line"
						checked={settings.indentWrapped}
						onChange={(indentWrapped) => onChange({ indentWrapped })}
					/>
				)}
			</div>

			<h3 className="settings-heading">Message input</h3>
			<div className="settings-card">
				<ToggleRow
					name="edgeToEdgeInput"
					label="Touch the edges"
					hint="Extend the input box to the sides and bottom of the chat pane, with square corners"
					checked={settings.edgeToEdgeInput}
					onChange={(edgeToEdgeInput) => onChange({ edgeToEdgeInput })}
				/>
			</div>

			<h3 className="settings-heading">Nicks</h3>
			<div className="settings-card">
				<ToggleRow
					name="nickColors"
					label="Nick colors"
					hint="Give each nick its own color"
					checked={settings.nickColors}
					onChange={(nickColors) => onChange({ nickColors })}
				/>
				<ToggleRow
					name="nickModes"
					label="Channel modes before nicks"
					hint="Show @ or + before senders, in the compact and columns layouts"
					checked={settings.nickModes}
					onChange={(nickModes) => onChange({ nickModes })}
				/>
			</div>

			{settings.layout === "columns" && (
				<>
					<h3 className="settings-heading">Columns layout</h3>
					<div className="settings-card">
						<SegmentedRow
							name="nickAlign"
							label="Nick alignment"
							hint="Against the column rule, or against the time"
							options={nickAligns}
							value={settings.nickAlign}
							onChange={(nickAlign) => onChange({ nickAlign })}
						/>
						<SegmentedRow
							name="nickColumnWidth"
							label="Nick column width"
							hint="In characters, longer nicks are cut"
							options={nickColumnWidths}
							value={settings.nickColumnWidth}
							onChange={(nickColumnWidth) => onChange({ nickColumnWidth })}
						/>
						<ToggleRow
							name="hideRepeatedNicks"
							label="Hide repeated nicks"
							hint="Leave the nick out of consecutive messages from the same sender"
							checked={settings.hideRepeatedNicks}
							onChange={(hideRepeatedNicks) => onChange({ hideRepeatedNicks })}
						/>
						<ToggleRow
							name="nickBrackets"
							label="Brackets around nicks"
							hint="Show <nick> instead of nick"
							checked={settings.nickBrackets}
							onChange={(nickBrackets) => onChange({ nickBrackets })}
						/>
					</div>
				</>
			)}
		</>
	);
}
