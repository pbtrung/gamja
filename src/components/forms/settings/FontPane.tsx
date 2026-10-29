import type { CSSProperties } from "react";
import {
	FONT_AREAS,
	FONT_IDS,
	FONT_SETTING_KEYS,
	TEXT_SIZE_MAX,
	TEXT_SIZE_MIN,
	fontSettings,
	type FontArea,
	type Settings,
} from "../../../state";
import { FONTS } from "../../../fonts";
import { NumberRow, SelectRow } from "./rows";

interface PaneProps {
	settings: Settings;
	onChange: (settings: Partial<Settings>) => void;
}

const AREAS: Record<FontArea, { title: string; sizeHint: string; sample: string }> = {
	bufferList: {
		title: "Buffer list",
		sizeHint: "Of the buffer names, in pixels",
		sample: "#gamja  #soju  Libera.Chat",
	},
	memberList: {
		title: "Member list",
		sizeHint: "Of the nicks, in pixels",
		sample: "@alice  +bob  carol",
	},
	header: {
		title: "Buffer header",
		sizeHint: "Of the buffer name, in pixels",
		sample: "#gamja · A simple IRC web client",
	},
	messages: {
		title: "Messages",
		sizeHint: "Of the messages and the message input, in pixels",
		sample: "<alice> The quick brown fox jumps over the lazy dog 0O 1lI",
	},
};

const fontOptions = FONT_IDS.map((id) => ({ value: id, label: FONTS[id].name }));

/** The Font tab: the font and text size of each area */
export default function FontPane({ settings, onChange }: PaneProps) {
	const sizeRange = `${TEXT_SIZE_MIN}–${TEXT_SIZE_MAX} px`;
	return (
		<>
			{FONT_AREAS.map((area) => {
				const keys = FONT_SETTING_KEYS[area];
				const { font, size } = fontSettings(settings, area);
				const { title, sizeHint, sample } = AREAS[area];
				return (
					<section key={area} className="font-area">
						<h3 className="settings-heading">{title}</h3>
						<div className="settings-card">
							<SelectRow
								name={keys.font}
								label="Font"
								options={fontOptions}
								value={font}
								onChange={(value) => onChange({ [keys.font]: value })}
							/>
							<NumberRow
								name={keys.size}
								label="Text size"
								hint={`${sizeHint} (${sizeRange})`}
								min={TEXT_SIZE_MIN}
								max={TEXT_SIZE_MAX}
								value={size}
								onChange={(value) => onChange({ [keys.size]: value })}
							/>
							<p
								className="font-sample"
								style={
									{ fontFamily: FONTS[font].family, fontSize: `${size}px` } as CSSProperties
								}
							>
								{sample}
							</p>
						</div>
					</section>
				);
			})}
		</>
	);
}
