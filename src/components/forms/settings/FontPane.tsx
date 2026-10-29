import { FONT_IDS, TEXT_SIZE_MAX, TEXT_SIZE_MIN, messageTextSize, type Settings } from "../../../state";
import { FONTS } from "../../../fonts";
import { NumberRow, SelectRow } from "./rows";

interface PaneProps {
	settings: Settings;
	onChange: (settings: Partial<Settings>) => void;
}

const fontOptions = FONT_IDS.map((id) => ({ value: id, label: FONTS[id].name }));

/** The Font tab: the font and text size of the messages */
export default function FontPane({ settings, onChange }: PaneProps) {
	const font = FONTS[settings.messagesFont] ?? FONTS.inter;
	const size = messageTextSize(settings);
	return (
		<section>
			<h3 className="settings-heading">Messages</h3>
			<div className="settings-card">
				<SelectRow
					name="messagesFont"
					label="Font"
					options={fontOptions}
					value={font.id}
					onChange={(value) => onChange({ messagesFont: value })}
				/>
				<NumberRow
					name="messageTextSize"
					label="Text size"
					hint={`Of the messages and the message input, in pixels (${TEXT_SIZE_MIN}–${TEXT_SIZE_MAX} px)`}
					min={TEXT_SIZE_MIN}
					max={TEXT_SIZE_MAX}
					value={size}
					onChange={(value) => onChange({ messageTextSize: value })}
				/>
				<p className="font-sample" style={{ fontFamily: font.family, fontSize: `${size}px` }}>
					&lt;alice&gt; The quick brown fox jumps over the lazy dog 0O 1lI
				</p>
			</div>
		</section>
	);
}
