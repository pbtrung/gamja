import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import ircProxy from "./tools/irc-proxy.ts";

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

/** The version shown in the UI: GAMJA_VERSION, else the latest git tag, e.g. v0.99.26 */
function version(): string {
	if (process.env.GAMJA_VERSION) {
		return process.env.GAMJA_VERSION;
	}
	try {
		return execFileSync("git", ["describe", "--tags", "--abbrev=0"], { encoding: "utf8" }).trim();
	} catch {
		return "dev";
	}
}
/** Write version.json, for stale pages to notice a new release, see app/update. */
function versionFile(version: string): Plugin {
	return {
		name: "gamja-version-file",
		apply: "build",
		generateBundle() {
			this.emitFile({
				type: "asset",
				fileName: "version.json",
				source: JSON.stringify({ version }) + "\n",
			});
		},
	};
}

const VERSION = version();

export default defineConfig({
	root: r("./src"),
	define: {
		"import.meta.env.GAMJA_VERSION": JSON.stringify(VERSION),
	},
	base: "./",
	publicDir: r("./public"),
	plugins: [react(), devCSP(), versionFile(VERSION), ircProxy(process.env.GAMJA_IRC_SERVER)],
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
				// Dependencies change less often than gamja: in their own
				// chunk, browsers keep them cached across gamja releases
				manualChunks: (id) => (id.includes("/node_modules/") ? "vendor" : undefined),
			},
		},
	},
});
