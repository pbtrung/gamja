export interface Theme {
	id: string;
	name: string;
	/** "system" follows the OS color scheme */
	scheme: "light" | "dark" | "system";
	/** Background, foreground and accent colors, for previews */
	swatch: [string, string, string];
}

export const THEMES: Theme[] = [
	{ id: "system", name: "System", scheme: "system", swatch: ["#fdfdfd", "#181818", "#2f6fb5"] },
	{ id: "light", name: "Light", scheme: "light", swatch: ["#fdfdfd", "#181818", "#2f6fb5"] },
	{ id: "dark", name: "Dark", scheme: "dark", swatch: ["#181818", "#dddddd", "#4f8fd6"] },
	{ id: "dracula", name: "Dracula", scheme: "dark", swatch: ["#282a36", "#f8f8f2", "#bd93f9"] },
	{
		id: "catppuccin-latte",
		name: "Catppuccin Latte",
		scheme: "light",
		swatch: ["#eff1f5", "#4c4f69", "#8839ef"],
	},
	{
		id: "catppuccin-frappe",
		name: "Catppuccin Frappé",
		scheme: "dark",
		swatch: ["#303446", "#c6d0f5", "#ca9ee6"],
	},
	{
		id: "catppuccin-macchiato",
		name: "Catppuccin Macchiato",
		scheme: "dark",
		swatch: ["#24273a", "#cad3f5", "#c6a0f6"],
	},
	{
		id: "catppuccin-mocha",
		name: "Catppuccin Mocha",
		scheme: "dark",
		swatch: ["#1e1e2e", "#cdd6f4", "#cba6f7"],
	},
	{
		id: "solarized-light",
		name: "Solarized Light",
		scheme: "light",
		swatch: ["#fdf6e3", "#51666c", "#1967a4"],
	},
	{
		id: "solarized-dark",
		name: "Solarized Dark",
		scheme: "dark",
		swatch: ["#002b36", "#92a1a3", "#53a5e2"],
	},
	{ id: "zenburn", name: "Zenburn", scheme: "dark", swatch: ["#3f3f3f", "#dcdccc", "#8cd0d3"] },
];

export function getTheme(id: string | undefined | null): Theme {
	return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Apply a text size, in pixels, to the buffer area. */
export function applyMessageTextSize(pixels: number, doc: Document = document): void {
	doc.documentElement.style.setProperty("--chat-font-size", `${pixels}px`);
}

/** Apply a theme to the document. */
export function applyTheme(id: string | undefined | null, doc: Document = document): void {
	const theme = getTheme(id);
	const root = doc.documentElement;

	// Don't animate every color change while switching themes
	root.classList.add("theme-switching");
	const win = doc.defaultView;
	win?.requestAnimationFrame?.(() =>
		win.requestAnimationFrame(() => root.classList.remove("theme-switching")),
	);

	if (theme.id === "system") {
		delete root.dataset.theme;
	} else {
		root.dataset.theme = theme.id;
	}

	// Keep the browser UI (e.g. the mobile address bar) in sync
	let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	if (!meta) {
		meta = doc.createElement("meta");
		meta.name = "theme-color";
		doc.head.appendChild(meta);
	}
	if (theme.scheme === "system") {
		meta.remove();
	} else {
		meta.content = theme.swatch[0];
	}
}
