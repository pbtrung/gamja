// Fonts of the interface areas, chosen in the Font settings. The font
// files are only downloaded once a font is used.
import "@fontsource-variable/jetbrains-mono/index.css";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "@fontsource-variable/literata/index.css";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource/iosevka/400.css";
import "@fontsource/iosevka/400-italic.css";
import "@fontsource/iosevka/600.css";
import "@fontsource/iosevka/700.css";
import "@fontsource/iosevka-aile/400.css";
import "@fontsource/iosevka-aile/400-italic.css";
import "@fontsource/iosevka-aile/600.css";
import "@fontsource/iosevka-aile/700.css";
import {
	DEFAULT_TEXT_SIZES,
	FONT_AREAS,
	fontSettings,
	type FontArea,
	type FontID,
	type Settings,
} from "./state";

export interface Font {
	id: FontID;
	name: string;
	/** CSS font-family */
	family: string;
}

export const FONTS: Record<FontID, Font> = {
	inter: { id: "inter", name: "Inter", family: "var(--font-sans)" },
	system: {
		id: "system",
		name: "System",
		family: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
	},
	literata: { id: "literata", name: "Literata", family: "'Literata Variable', Georgia, serif" },
	"iosevka-aile": {
		id: "iosevka-aile",
		name: "Iosevka Aile (dense sans)",
		family: "'Iosevka Aile', var(--font-sans)",
	},
	iosevka: { id: "iosevka", name: "Iosevka (dense mono)", family: "Iosevka, var(--font-mono)" },
	"jetbrains-mono": {
		id: "jetbrains-mono",
		name: "JetBrains Mono",
		family: "'JetBrains Mono Variable', var(--font-mono)",
	},
	monospace: { id: "monospace", name: "System monospace", family: "var(--font-mono)" },
};

/**
 * CSS variables of each area, see styles/tokens.css: the messages get their
 * size, the other areas a factor of their text sizes, the default size of
 * their main text being 1.
 */
const AREA_VARIABLES: Record<FontArea, { family: string; size?: string; scale?: string }> = {
	bufferList: { family: "--buffer-list-font", scale: "--buffer-list-scale" },
	memberList: { family: "--member-list-font", scale: "--member-list-scale" },
	header: { family: "--header-font", scale: "--header-scale" },
	messages: { family: "--messages-font", size: "--chat-font-size" },
};

/** Apply the font settings of every area to the document. */
export function applyFonts(settings: Settings, doc: Document = document): void {
	const style = doc.documentElement.style;
	for (const area of FONT_AREAS) {
		const { font, size } = fontSettings(settings, area);
		const vars = AREA_VARIABLES[area];
		style.setProperty(vars.family, FONTS[font].family);
		if (vars.size) {
			style.setProperty(vars.size, `${size}px`);
		}
		if (vars.scale) {
			style.setProperty(vars.scale, String(size / DEFAULT_TEXT_SIZES[area]));
		}
	}
}
