import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import ircProxy from "./tools/irc-proxy.js";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The dev server injects inline styles and the React refresh preamble, which
 * the production Content-Security-Policy forbids: drop it while developing.
 */
function devCSP(): Plugin {
	return {
		name: "gamja-dev-csp",
		apply: "serve",
		transformIndexHtml(html) {
			return html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*>/s, "");
		},
	};
}

/** The version shown in the UI: GAMJA_VERSION, else from git, e.g. v1.2-3-gabcdef */
function version(): string {
	if (process.env.GAMJA_VERSION) {
		return process.env.GAMJA_VERSION;
	}
	try {
		return execFileSync("git", ["describe", "--tags", "--always"], { encoding: "utf8" }).trim();
	} catch {
		return "dev";
	}
}

export default defineConfig({
	root: r("./src"),
	define: {
		"import.meta.env.GAMJA_VERSION": JSON.stringify(version()),
	},
	base: "./",
	publicDir: r("./public"),
	plugins: [react(), devCSP(), ircProxy(process.env.GAMJA_IRC_SERVER)],
	server: {
		port: 8080,
	},
	build: {
		outDir: r("./dist"),
		emptyOutDir: true,
		sourcemap: false,
		rollupOptions: {
			input: {
				index: r("./src/index.html"),
				// The service worker must live at the root to control the whole app
				sw: r("./src/sw.ts"),
			},
			output: {
				entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
			},
		},
	},
});
