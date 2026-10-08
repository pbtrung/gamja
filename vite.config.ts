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

export default defineConfig({
	root: r("./src"),
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
	},
});
