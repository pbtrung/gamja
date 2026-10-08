import AppController from "../../src/app/controller";
import { FakeWebSocket, installFakeWebSocket } from "./fake-ws";

export interface Harness {
	app: AppController;
	ws: FakeWebSocket;
	serverID: number;
	/** Feed lines from the server */
	recv: (...lines: string[]) => void;
	/** Messages sent by the client since the last call, as raw lines without tags */
	sent: () => string[];
	/** Same as sent(), keeping tags */
	sentRaw: () => string[];
}

/**
 * Create a controller connected to a fake server. The fake server ACKs the
 * given caps and completes registration.
 */
export async function connectedApp({
	caps = "batch server-time echo-message message-tags labeled-response draft/chathistory draft/read-marker",
	isupport = "CASEMAPPING=rfc1459 CHANTYPES=# PREFIX=(ov)@+ CHATHISTORY=100 MONITOR=100 WHOX NETWORK=TestNet",
	nick = "me",
	register = true,
}: { caps?: string; isupport?: string; nick?: string; register?: boolean } = {}): Promise<Harness> {
	installFakeWebSocket();
	const app = new AppController();
	app.debug = false;
	await app.handleConfig({ server: { url: "wss://irc.test/socket" } });
	const serverID = app.connect({ nick, url: "wss://irc.test/socket" });
	const ws = FakeWebSocket.last();
	ws.open();
	const recv = (...lines: string[]) => ws.receive(...lines);
	const sentRaw = () => {
		const l = ws.sent;
		ws.sent = [];
		return l;
	};
	const sent = () => sentRaw().map((l) => l.replace(/^@\S+ /, ""));
	if (register) {
		recv(`:srv CAP * LS :${caps}`);
		recv(
			`:srv CAP ${nick} ACK :${caps
				.split(" ")
				.filter((c) => c && !c.includes("="))
				.join(" ")}`,
		);
		recv(
			`:srv 001 ${nick} :Welcome`,
			`:srv 005 ${nick} ${isupport} :are supported`,
			`:srv 376 ${nick} :End of MOTD`,
		);
		sent();
	}
	return { app, ws, serverID, recv, sent, sentRaw };
}

/** Wait for pending promises and timers scheduled with a zero delay. */
export function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}
