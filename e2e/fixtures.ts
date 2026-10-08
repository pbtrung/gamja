import { test as base, expect, type Page } from "@playwright/test";
import WebSocket from "ws";
import { FakeServer, format, parse, startServer, type ServerOptions } from "./fake-ircd.ts";

/** A scripted IRC user connected to the fake server, playing the other side of conversations. */
export class Bot {
	ws: WebSocket;
	nick: string;
	received: string[] = [];
	private waiters: { pred: (line: string) => boolean; resolve: (line: string) => void }[] = [];

	private constructor(ws: WebSocket, nick: string) {
		this.ws = ws;
		this.nick = nick;
		ws.on("message", (data) => {
			const line = data.toString();
			this.received.push(line);
			const msg = parse(line);
			if (msg.command === "PING") {
				this.send(`PONG :${msg.params[0]}`);
			}
			this.waiters = this.waiters.filter((w) => {
				if (w.pred(line)) {
					w.resolve(line);
					return false;
				}
				return true;
			});
		});
	}

	static async connect(
		server: FakeServer,
		nick: string,
		caps = "message-tags server-time echo-message",
	): Promise<Bot> {
		const ws = new WebSocket(`ws://localhost:${server.port}`);
		await new Promise((resolve, reject) => {
			ws.once("open", resolve);
			ws.once("error", reject);
		});
		const bot = new Bot(ws, nick);
		bot.send("CAP LS 302");
		bot.send(`CAP REQ :${caps}`);
		bot.send(`NICK ${nick}`);
		bot.send(`USER ${nick} 0 * :${nick} the bot`);
		bot.send("CAP END");
		await bot.waitFor((l) => / 376 /.test(l));
		return bot;
	}

	send(line: string): void {
		this.ws.send(line);
	}

	waitFor(pred: (line: string) => boolean, timeout = 5000): Promise<string> {
		const found = this.received.find(pred);
		if (found) {
			return Promise.resolve(found);
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`${this.nick}: timed out waiting for a message`)),
				timeout,
			);
			this.waiters.push({
				pred,
				resolve: (line) => {
					clearTimeout(timer);
					resolve(line);
				},
			});
		});
	}

	async join(channel: string): Promise<void> {
		this.send(`JOIN ${channel}`);
		await this.waitFor((l) => l.includes(` 366 ${this.nick} ${channel} `));
	}

	privmsg(target: string, text: string, tags: Record<string, string> = {}): void {
		this.send(format({ tags, command: "PRIVMSG", params: [target, text] }));
	}

	close(): void {
		this.ws.close();
	}
}

export interface Fixtures {
	ircd: FakeServer;
	serverOptions: Partial<ServerOptions>;
	bot: (nick: string) => Promise<Bot>;
	connect: (page: Page, nick?: string, opts?: { password?: string; channels?: string[] }) => Promise<void>;
	/** Start the page with these settings stored, as if picked earlier */
	settings: (settings: Record<string, unknown>) => Promise<void>;
}

export const test = base.extend<Fixtures>({
	serverOptions: [{}, { option: true }],
	settings: async ({ page }, use) => {
		await use(async (settings) => {
			await page.addInitScript(
				(v) => localStorage.setItem("gamja_settings", v),
				JSON.stringify(settings),
			);
		});
	},
	ircd: async ({ serverOptions }, use) => {
		const server = startServer({ port: 0, accounts: { alice: "secret" }, ...serverOptions });
		await new Promise((resolve) => server.wss.once("listening", resolve));
		await use(server);
		await server.close();
	},
	bot: async ({ ircd }, use) => {
		const bots: Bot[] = [];
		await use(async (nick) => {
			const bot = await Bot.connect(ircd, nick);
			bots.push(bot);
			return bot;
		});
		bots.forEach((b) => b.close());
	},
	connect: async ({ ircd }, use) => {
		await use(async (page, nick = "tester", opts = {}) => {
			const params = new URLSearchParams({ server: `ws://localhost:${ircd.port}` });
			if (opts.channels) {
				params.set("channels", opts.channels.join(","));
			}
			await page.goto("/?" + params.toString());
			await page.getByLabel("Nickname").fill(nick);
			if (opts.password) {
				await page.getByLabel("Password", { exact: true }).fill(opts.password);
			}
			await page.getByRole("button", { name: "Connect" }).click();
			await expect(page.getByRole("tab", { name: "FakeNet", includeHidden: true })).toHaveCount(1);
			await expect(page.locator("#buffer-header")).toBeVisible();
		});
	},
});

export { expect };
