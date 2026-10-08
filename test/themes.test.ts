import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEMES, applyTheme, getTheme } from "../src/themes";

const css = readFileSync("src/styles/themes.css", "utf8");
const tokensCSS = readFileSync("src/styles/tokens.css", "utf8");

function tokens(selector: string, source = css): Record<string, string> {
	const escaped = selector.replace(/[[\]"()]/g, "\\$&");
	const m = source.match(new RegExp(escaped + "\\s*\\{([^}]*)\\}"));
	if (!m) {
		throw new Error("No CSS block for " + selector);
	}
	return Object.fromEntries(
		[...m[1].matchAll(/(--[\w-]+|color-scheme):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]),
	);
}

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [la, lb] = [luminance(a), luminance(b)];
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("themes", () => {
	it("applies themes to the document", () => {
		applyTheme("dracula");
		expect(document.documentElement.dataset.theme).toBe("dracula");
		expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute("content", "#282a36");
		applyTheme("system");
		expect(document.documentElement.dataset.theme).toBeUndefined();
		expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
		applyTheme("nope");
		expect(document.documentElement.dataset.theme).toBeUndefined();
		expect(getTheme(undefined).id).toBe("system");
	});

	it("includes the requested themes", () => {
		const names = THEMES.map((t) => t.name);
		for (const name of [
			"Dracula",
			"Catppuccin Latte",
			"Catppuccin Mocha",
			"Solarized Light",
			"Solarized Dark",
			"Zenburn",
		]) {
			expect(names).toContain(name);
		}
	});

	const lightTokens = tokens(":root", tokensCSS);
	const required = Object.keys(lightTokens).filter(
		(k) =>
			k !== "--font-sans" &&
			k !== "--font-mono" &&
			!k.startsWith("--radius") &&
			!k.startsWith("--sidebar") &&
			!k.startsWith("--member") &&
			!k.startsWith("--header") &&
			!k.startsWith("--chat") &&
			k !== "--transition",
	);

	for (const theme of THEMES.filter((t) => t.id !== "system")) {
		describe(theme.name, () => {
			const t = theme.id === "light" ? lightTokens : tokens(`:root[data-theme="${theme.id}"]`);

			it("defines every color token", () => {
				for (const k of required) {
					expect(t, `${theme.id} is missing ${k}`).toHaveProperty(k);
				}
				expect(t["color-scheme"]).toBe(theme.scheme);
			});

			it("has a matching preview swatch", () => {
				expect(theme.swatch[0]).toBe(t["--bg"]);
			});

			it("has readable text", () => {
				expect(contrast(t["--fg"], t["--bg"])).toBeGreaterThanOrEqual(4.5);
				expect(contrast(t["--fg-muted"], t["--bg"])).toBeGreaterThanOrEqual(4);
				expect(contrast(t["--accent"], t["--bg"])).toBeGreaterThanOrEqual(4.5);
				expect(contrast(t["--accent-fg"], t["--accent"])).toBeGreaterThanOrEqual(4.5);
				expect(contrast(t["--danger-fg"], t["--bg"])).toBeGreaterThanOrEqual(4);
			});
		});
	}
});
