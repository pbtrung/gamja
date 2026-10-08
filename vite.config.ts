import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import ircProxy from "./tools/irc-proxy.js";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
	root: r("./src"),
	base: "./",
	publicDir: r("./public"),
	plugins: [ircProxy(process.env.GAMJA_IRC_SERVER)],
	server: {
		port: 8080,
	},
	build: {
		outDir: r("./dist"),
		emptyOutDir: true,
		sourcemap: false,
	},
});
