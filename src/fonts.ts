// Fonts of the messages, chosen in the Font settings. The font files are
// only downloaded once a font is used.
import "@fontsource-variable/jetbrains-mono/index.css";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import { messageTextSize, type FontID, type Settings } from "./state";

export interface Font {
	id: FontID;
	name: string;
	/** CSS font-family */
	family: string;
}

export const FONTS: Record<FontID, Font> = {
	inter: { id: "inter", name: "Inter", family: "var(--font-sans)" },
	"jetbrains-mono": {
		id: "jetbrains-mono",
		name: "JetBrains Mono",
		family: "'JetBrains Mono Variable', var(--font-mono)",
	},
};

/** Apply the font settings of the messages to the document, see the
 * --messages-font and --chat-font-size variables in styles/tokens.css. */
export function applyFonts(settings: Settings, doc: Document = document): void {
	const style = doc.documentElement.style;
	const font = FONTS[settings.messagesFont] ?? FONTS.inter;
	style.setProperty("--messages-font", font.family);
	style.setProperty("--chat-font-size", `${messageTextSize(settings)}px`);
}
