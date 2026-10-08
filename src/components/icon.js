import { h } from "../lib/index.js";

/**
 * Render a Lucide icon.
 *
 * The icon is decorative by default (hidden from assistive technology): give
 * the surrounding element an accessible name, e.g. via a title attribute.
 */
export default function Icon({ icon, size = "1em", class: className, ...props }) {
	let classes = "icon";
	if (className) {
		classes += " " + className;
	}
	return h(
		"svg",
		{
			xmlns: "http://www.w3.org/2000/svg",
			width: size,
			height: size,
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": 2,
			"stroke-linecap": "round",
			"stroke-linejoin": "round",
			"aria-hidden": "true",
			focusable: "false",
			class: classes,
			...props,
		},
		icon.map(([tag, attrs]) => h(tag, attrs)),
	);
}
