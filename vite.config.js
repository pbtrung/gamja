import { defineConfig } from "vite";
import ircProxy from "./tools/irc-proxy.js";

export default defineConfig({
	base: "./",
	plugins: [ircProxy(process.env.GAMJA_IRC_SERVER)],
	server: {
		port: 8080,
	},
	build: {
		sourcemap: false,
	},
});
