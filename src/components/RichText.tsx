import { memo, type CSSProperties, type MouseEvent } from "react";
import { parse as parseFormatting, cssColor, type Style } from "../lib/ansi";
import { findLinks } from "../lib/linkify";

export type LinkClickHandler = (event: MouseEvent<HTMLAnchorElement>) => void;

function styleToCSS(style: Style): { className?: string; css?: CSSProperties } {
	const classes: string[] = [];
	if (style.bold) {
		classes.push("fmt-bold");
	}
	if (style.italic) {
		classes.push("fmt-italic");
	}
	if (style.underline) {
		classes.push("fmt-underline");
	}
	if (style.strikethrough) {
		classes.push("fmt-strikethrough");
	}
	if (style.monospace) {
		classes.push("fmt-monospace");
	}
	const css: CSSProperties = {};
	const fg = cssColor(style.fg);
	const bg = cssColor(style.bg);
	if (fg) {
		css.color = fg;
	}
	if (bg) {
		css.backgroundColor = bg;
	}
	return {
		className: classes.length > 0 ? classes.join(" ") : undefined,
		css: fg || bg ? css : undefined,
	};
}

/** Render text with links. */
export function Linkified({ text, onLinkClick }: { text: string; onLinkClick?: LinkClickHandler }) {
	return (
		<>
			{findLinks(text).map((seg, i) =>
				seg.href ? (
					<a
						key={i}
						href={seg.href}
						target="_blank"
						rel="noreferrer noopener"
						onClick={onLinkClick}
					>
						{seg.text}
					</a>
				) : (
					seg.text
				),
			)}
		</>
	);
}

interface RichTextProps {
	text: string;
	onLinkClick?: LinkClickHandler;
	/** Render IRC formatting (colors, bold…), otherwise strip it */
	formatting?: boolean;
}

/** Render IRC-formatted text with links. */
function RichText({ text, onLinkClick, formatting = true }: RichTextProps) {
	const segments = parseFormatting(text);
	if (!formatting || segments.every((seg) => !seg.style || Object.values(seg.style).every((v) => !v))) {
		return <Linkified text={segments.map((s) => s.text).join("")} onLinkClick={onLinkClick} />;
	}
	return (
		<>
			{segments.map((seg, i) => {
				const { className, css } = styleToCSS(seg.style);
				if (!className && !css) {
					return <Linkified key={i} text={seg.text} onLinkClick={onLinkClick} />;
				}
				return (
					<span key={i} className={className} style={css}>
						<Linkified text={seg.text} onLinkClick={onLinkClick} />
					</span>
				);
			})}
		</>
	);
}

export default memo(RichText);
