import * as tls from "node:tls";
import type { Plugin } from "vite";
import { WebSocketServer, type WebSocket } from "ws";

const WS_BAD_GATEWAY = 1014;

/**
 * Vite plugin proxying WebSocket connections on /socket to a remote IRC
 * server over TLS. Enabled when the GAMJA_IRC_SERVER environment variable is
 * set, e.g. GAMJA_IRC_SERVER=irc.libera.chat or irc.example.org:6697.
 */
export default function ircProxy(remote: string | undefined): Plugin {
	return {
		name: "gamja-irc-proxy",
		configureServer(server) {
			if (!remote || !server.httpServer) {
				return;
			}

			const [host, portStr] = remote.split(":");
			const port = portStr ? parseInt(portStr, 10) : 6697;

			const wsServer = new WebSocketServer({ noServer: true });
			server.httpServer.on("upgrade", (req, socket, head) => {
				const url = new URL(req.url ?? "/", "http://localhost");
				if (url.pathname !== "/socket") {
					return; // Leave other upgrades (e.g. Vite HMR) alone
				}
				wsServer.handleUpgrade(req, socket, head, (ws) => {
					handleConnection(ws, host, port);
				});
			});

			server.config.logger.info(`  ➜  Proxying /socket to ${host}:${port}`);
		},
	};
}

function handleConnection(ws: WebSocket, host: string, port: number) {
	const client = tls.connect(port, host, { ALPNProtocols: ["irc"] });

	ws.on("message", (data) => {
		client.write(data.toString() + "\r\n");
	});
	ws.on("close", () => {
		client.destroy();
	});

	let buf = "";
	client.setEncoding("utf8");
	client.on("data", (chunk) => {
		buf += chunk;
		const lines = buf.split("\n");
		buf = lines.pop()!;
		for (let line of lines) {
			line = line.replace(/\r$/, "");
			if (line) {
				ws.send(line);
			}
		}
	});
	client.on("end", () => {
		ws.close();
	});
	client.on("error", (err) => {
		console.error(err);
		ws.close(WS_BAD_GATEWAY);
	});
}
