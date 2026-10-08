// IRC formatting codes, see https://modern.ircdocs.horse/formatting.html

const BOLD = "\x02";
const ITALIC = "\x1D";
const UNDERLINE = "\x1F";
const STRIKETHROUGH = "\x1E";
const MONOSPACE = "\x11";
const COLOR = "\x03";
const COLOR_HEX = "\x04";
const REVERSE_COLOR = "\x16";
const RESET = "\x0F";

const HEX_COLOR_LENGTH = 6;

function isDigit(ch: string | undefined): boolean {
	return ch !== undefined && ch >= "0" && ch <= "9";
}

function isHexColor(text: string): boolean {
	return /^[0-9a-f]{6}/i.test(text);
}

export interface Style {
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	monospace?: boolean;
	/** mIRC color index (0-98) or "#rrggbb" */
	fg?: number | string;
	bg?: number | string;
}

export interface Segment {
	text: string;
	style: Style;
}

/** Parse IRC formatting into styled text segments. */
export function parse(text: string): Segment[] {
	const segments: Segment[] = [];
	let style: Style = {};
	let cur = "";

	const flush = () => {
		if (cur) {
			segments.push({ text: cur, style });
			cur = "";
		}
	};
	const update = (patch: Style | null) => {
		flush();
		style = patch === null ? {} : { ...style, ...patch };
	};

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		switch (ch) {
			case BOLD:
				update({ bold: !style.bold });
				break;
			case ITALIC:
				update({ italic: !style.italic });
				break;
			case UNDERLINE:
				update({ underline: !style.underline });
				break;
			case STRIKETHROUGH:
				update({ strikethrough: !style.strikethrough });
				break;
			case MONOSPACE:
				update({ monospace: !style.monospace });
				break;
			case REVERSE_COLOR:
				update({ fg: style.bg ?? 0, bg: style.fg ?? 1 });
				break;
			case RESET:
				update(null);
				break;
			case COLOR: {
				if (!isDigit(text[i + 1])) {
					update({ fg: undefined, bg: undefined });
					break;
				}
				let fg = text[++i];
				if (isDigit(text[i + 1])) {
					fg += text[++i];
				}
				const patch: Style = { fg: parseInt(fg, 10) };
				if (text[i + 1] === "," && isDigit(text[i + 2])) {
					i += 2;
					let bg = text[i];
					if (isDigit(text[i + 1])) {
						bg += text[++i];
					}
					patch.bg = parseInt(bg, 10);
				}
				update(patch);
				break;
			}
			case COLOR_HEX: {
				if (!isHexColor(text.slice(i + 1))) {
					update({ fg: undefined, bg: undefined });
					break;
				}
				const patch: Style = { fg: "#" + text.slice(i + 1, i + 1 + HEX_COLOR_LENGTH) };
				i += HEX_COLOR_LENGTH;
				if (text[i + 1] === "," && isHexColor(text.slice(i + 2))) {
					patch.bg = "#" + text.slice(i + 2, i + 2 + HEX_COLOR_LENGTH);
					i += 1 + HEX_COLOR_LENGTH;
				}
				update(patch);
				break;
			}
			default:
				cur += ch;
		}
	}
	flush();
	return segments;
}

/** Strip IRC formatting codes from text. */
export function strip(text: string): string {
	return parse(text)
		.map((seg) => seg.text)
		.join("");
}

/** The 99 standard mIRC colors. */
export const COLORS: readonly string[] = [
	"#ffffff",
	"#000000",
	"#00007f",
	"#009300",
	"#ff0000",
	"#7f0000",
	"#9c009c",
	"#fc7f00",
	"#ffff00",
	"#00fc00",
	"#009393",
	"#00ffff",
	"#0000fc",
	"#ff00ff",
	"#7f7f7f",
	"#d2d2d2",
	"#470000",
	"#472100",
	"#474700",
	"#324700",
	"#004700",
	"#00472c",
	"#004747",
	"#002747",
	"#000047",
	"#2e0047",
	"#470047",
	"#47002a",
	"#740000",
	"#743a00",
	"#747400",
	"#517400",
	"#007400",
	"#007449",
	"#007474",
	"#004074",
	"#000074",
	"#4b0074",
	"#740074",
	"#740045",
	"#b50000",
	"#b56300",
	"#b5b500",
	"#7db500",
	"#00b500",
	"#00b571",
	"#00b5b5",
	"#0063b5",
	"#0000b5",
	"#7500b5",
	"#b500b5",
	"#b5006b",
	"#ff0000",
	"#ff8c00",
	"#ffff00",
	"#b2ff00",
	"#00ff00",
	"#00ffa0",
	"#00ffff",
	"#008cff",
	"#0000ff",
	"#a500ff",
	"#ff00ff",
	"#ff0098",
	"#ff5959",
	"#ffb459",
	"#ffff71",
	"#cfff60",
	"#6fff6f",
	"#65ffc9",
	"#6dffff",
	"#59b4ff",
	"#5959ff",
	"#c459ff",
	"#ff66ff",
	"#ff59bc",
	"#ff9c9c",
	"#ffd39c",
	"#ffff9c",
	"#e2ff9c",
	"#9cff9c",
	"#9cffdb",
	"#9cffff",
	"#9cd3ff",
	"#9c9cff",
	"#dc9cff",
	"#ff9cff",
	"#ff94d3",
	"#000000",
	"#131313",
	"#282828",
	"#363636",
	"#4d4d4d",
	"#656565",
	"#818181",
	"#9f9f9f",
	"#bcbcbc",
	"#e2e2e2",
	"#ffffff",
];

/** Resolve a style color to a CSS color, or undefined for the default. */
export function cssColor(c: number | string | undefined): string | undefined {
	if (c === undefined) {
		return undefined;
	}
	if (typeof c === "string") {
		return c;
	}
	return COLORS[c];
}
