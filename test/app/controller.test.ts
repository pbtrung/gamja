import { describe, expect, it, vi } from "vitest";
import { connectedApp, flush } from "../helpers/app";
import { getBuffer, createBuffer, createServer, SERVER_BUFFER, Unread, BufferType } from "../../src/state";
import * as S from "../../src/state";
import type { Buffer } from "../../src/state";
import * as store from "../../src/store";
import AppController from "../../src/app/controller";
import { FakeWebSocket, installFakeWebSocket } from "../helpers/fake-ws";
import * as irc from "../../src/lib/irc";

function buf(app: AppController, name: string) {
	return getBuffer(app.state, { name });
}

describe("AppController configuration", () => {
	it("fills connect params from config and URL", async () => {
		window.history.replaceState(null, "", "/?nick=guest-*&channels=%23a,,%23b,&debug=1");
		const app = new AppController();
		await app.handleConfig({ server: { url: "wss://cfg/socket", autojoin: "#cfg", ping: 30 } });
		const params = app.state.connectParams;
		expect(params.url).toBe("wss://cfg/socket");
		expect(params.nick).toMatch(/^guest-[a-z0-9]+$/);
		expect(params.autojoin).toEqual(["#a", "#b"]);
		expect(params.ping).toBe(30);
		expect(app.debug).toBe(true);
		expect(app.state.loading).toBe(false);
		expect(app.state.connectForm).toBe(true);
		window.history.replaceState(null, "", "/");
	});

	it("doesn't let the URL override a configured server", async () => {
		window.history.replaceState(null, "", "/?server=wss://evil");
		const app = new AppController();
		await app.handleConfig({ server: { url: "wss://good" } });
		expect(app.state.connectParams.url).toBe("wss://good");
		window.history.replaceState(null, "", "/");
	});

	it("auto-connects with stored credentials", async () => {
		installFakeWebSocket();
		store.autoconnect.put({ url: "wss://stored", nick: "saved", autoconnect: true });
		const app = new AppController();
		await app.handleConfig({ server: {} });
		expect(app.state.connectForm).toBe(false);
		expect(FakeWebSocket.last().url).toBe("wss://stored");
		app.destroy();
	});

	it("doesn't send remembered credentials to a server from the URL", async () => {
		installFakeWebSocket();
		window.history.replaceState(null, "", "/?server=wss://evil");
		store.autoconnect.put({
			url: "",
			nick: "alice",
			saslPlain: { username: "alice", password: "secret" },
			autoconnect: true,
		});
		const app = new AppController();
		await app.handleConfig({ server: {} });
		expect(FakeWebSocket.last().url).not.toContain("evil");
		expect(app.state.connectParams.url).toBe("");
		window.history.replaceState(null, "", "/");
		app.destroy();
	});

	it("shows the connect form without the remembered login for an empty server", async () => {
		installFakeWebSocket();
		window.history.replaceState(null, "", "/?server=");
		store.autoconnect.put({
			url: "wss://stored",
			nick: "alice",
			saslPlain: { username: "alice", password: "secret" },
			autoconnect: true,
		});
		const app = new AppController();
		await app.handleConfig({ server: { url: "wss://cfg" } });
		expect(app.state.connectForm).toBe(true);
		expect(app.clients.size).toBe(0);
		expect(app.state.connectParams).toMatchObject({ url: "", autoconnect: false });
		expect(app.state.connectParams.saslPlain).toBeFalsy();
		window.history.replaceState(null, "", "/");
	});

	it("rejects autoconnect with mandatory auth", async () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		const app = new AppController();
		await app.handleConfig({ server: { autoconnect: true, auth: "mandatory" } });
		expect(app.state.connectParams.autoconnect).toBe(false);
		expect(err).toHaveBeenCalled();
	});
});

describe("AppController OAuth 2.0", () => {
	const oauth2Config = {
		server: { auth: "oauth2" as const },
		oauth2: { url: "https://auth.example", client_id: "gamja" },
	};
	const metadata = {
		issuer: "https://auth.example",
		authorization_endpoint: "https://auth.example/authorize",
		token_endpoint: "https://auth.example/token",
		response_types_supported: ["code"],
	};
	const json = (data: unknown) =>
		new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });

	it("reports authorization errors", async () => {
		window.history.replaceState(null, "", "/?error=access_denied&error_description=Nope");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const app = new AppController();
		await app.handleConfig(oauth2Config);
		expect(app.state.error).toBe("Authentication failed: Nope");
		// Reloading starts a new authorization instead of failing again
		expect(window.location.search).toBe("");
		window.history.replaceState(null, "", "/");
	});

	it("refuses a code for an authorization it didn't start", async () => {
		window.history.replaceState(null, "", "/?code=c&state=forged");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const app = new AppController();
		await app.handleConfig(oauth2Config);
		expect(app.state.error).toMatch(/doesn't match/);
		expect(fetch).not.toHaveBeenCalled();
		// The code is stripped so that reloading doesn't retry it
		expect(window.location.search).toBe("");
	});

	it("exchanges the code with the redirect URI and verifier of the request", async () => {
		installFakeWebSocket();
		const pending = { state: "s", codeVerifier: "v", redirectUri: "http://localhost:3000/?x=1" };
		sessionStorage.setItem("gamja_oauth2_pending", JSON.stringify(pending));
		window.history.replaceState(null, "", "/?x=1&code=c&state=s#/#chan");
		const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
			url === metadata.token_endpoint ? json({ access_token: "tok" }) : json(metadata),
		);
		vi.stubGlobal("fetch", fetch);
		const app = new AppController();
		await app.handleConfig(oauth2Config);
		const tokenCall = fetch.mock.calls.find(([url]) => url === metadata.token_endpoint)!;
		const body = new URLSearchParams(tokenCall[1]!.body as string);
		expect(body.get("code")).toBe("c");
		expect(body.get("code_verifier")).toBe("v");
		expect(body.get("redirect_uri")).toBe("http://localhost:3000/?x=1");
		expect(app.state.connectParams.saslOauthBearer).toMatchObject({ token: "tok" });
		window.history.replaceState(null, "", "/");
		app.destroy();
	});
	it("authorizes again instead of using an expired remembered token", async () => {
		installFakeWebSocket();
		const assign = vi.fn();
		const href = window.location.href;
		vi.stubGlobal("location", { ...window.location, href, toString: () => href, assign });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => json(metadata)),
		);
		store.autoconnect.put({
			nick: "alice",
			saslOauthBearer: { token: "old", expiresAt: Date.now() - 1000 },
			autoconnect: true,
		});
		const app = new AppController();
		await app.handleConfig(oauth2Config);
		expect(assign).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/auth\.example\/authorize\?/));
		expect(app.clients.size).toBe(0);
	});

	it("keeps the expiry of a new token", async () => {
		installFakeWebSocket();
		const pending = { state: "s", codeVerifier: "v", redirectUri: "http://localhost:3000/" };
		sessionStorage.setItem("gamja_oauth2_pending", JSON.stringify(pending));
		window.history.replaceState(null, "", "/?code=c&state=s");
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url === metadata.token_endpoint
					? json({ access_token: "tok", expires_in: 3600 })
					: json(metadata),
			),
		);
		const app = new AppController();
		await app.handleConfig(oauth2Config);
		const expiresAt = app.state.connectParams.saslOauthBearer!.expiresAt!;
		expect(expiresAt - Date.now()).toBeGreaterThan(3500 * 1000);
		window.history.replaceState(null, "", "/");
	});

	it("forgets a rejected token and authorizes again from the connect form", async () => {
		installFakeWebSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const saslOauthBearer = { token: "revoked" };
		store.autoconnect.put({ nick: "alice", saslOauthBearer, autoconnect: true });
		const app = new AppController();
		await app.handleConfig(oauth2Config);
		expect(app.state.connectForm).toBe(false);
		const ws = FakeWebSocket.last();
		ws.open();
		ws.receive(":srv CAP * LS :sasl=OAUTHBEARER", ":srv CAP alice ACK :sasl");
		const challenge = btoa(JSON.stringify({ status: "invalid_token" }));
		ws.receive(`AUTHENTICATE ${challenge}`, ":srv 904 alice :SASL authentication failed");
		await flush();
		expect(app.state.error).toMatch(/invalid or expired/);
		expect(store.autoconnect.load()?.saslOauthBearer).toBeFalsy();
		expect(app.state.connectParams.saslOauthBearer).toBeNull();
		expect(app.state.connectForm).toBe(true);

		const assign = vi.fn();
		const href = window.location.href;
		vi.stubGlobal("location", { ...window.location, href, toString: () => href, assign });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => json(metadata)),
		);
		app.handleConnectSubmit({ ...app.state.connectParams, autoconnect: true });
		// Metadata, then the PKCE challenge
		await vi.waitFor(() => expect(assign).toHaveBeenCalled());
		// Remembered without the token, to connect once authorized again
		expect(store.autoconnect.load()).toMatchObject({ nick: "alice", autoconnect: true });
		app.destroy();
	});
});

describe("AppController messaging", () => {
	it("creates the server buffer and leaves the connect form on registration", async () => {
		const { app, serverID } = await connectedApp();
		expect(app.state.connectForm).toBe(false);
		expect(app.state.servers.get(serverID)!.name).toBe("TestNet");
		expect(buf(app, SERVER_BUFFER)?.messages.some((m) => m.command === "001")).toBe(true);
		expect(app.state.activeBuffer).toBe(buf(app, SERVER_BUFFER)!.id);
	});

	it("routes channel messages and tracks unread state", async () => {
		const { app, recv, sent } = await connectedApp();
		recv(":me!u@h JOIN #c", ":srv 366 me #c :End");
		expect(buf(app, "#c")?.joined).toBe(true);
		sent();

		recv("@time=2030-01-01T00:00:00.000Z;msgid=1 :bob!u@h PRIVMSG #c :hello");
		expect(buf(app, "#c")!.messages.at(-1)!.params[1]).toBe("hello");
		expect(buf(app, "#c")!.unread).toBe(Unread.MESSAGE);

		recv("@time=2030-01-01T00:00:01.000Z;msgid=2 :bob!u@h PRIVMSG #c :hey me!");
		expect(buf(app, "#c")!.unread).toBe(Unread.HIGHLIGHT);
		expect(document.title).toMatch(/^\(1\) /);

		app.switchBuffer(buf(app, "#c")!.id);
		expect(buf(app, "#c")!.unread).toBe(Unread.NONE);
		// The read marker is sent to the server
		expect(sent()).toContain("MARKREAD #c timestamp=2030-01-01T00:00:01.000Z");
	});

	it("opens a buffer for private messages", async () => {
		const { app, recv } = await connectedApp();
		recv(":bob!u@h PRIVMSG me :psst");
		expect(buf(app, "bob")?.type).toBe(BufferType.NICK);
		expect(buf(app, "bob")!.unread).toBe(Unread.HIGHLIGHT);
	});

	it("queries the user of a conversation once", async () => {
		const { app, recv, sent } = await connectedApp();
		sent();
		const queries = async () => {
			await flush();
			return sent().filter((l) => /^(WHO|MONITOR|MARKREAD) /.test(l));
		};
		app.handleComposerSubmit("/query bob");
		const opened = await queries();
		expect(opened.filter((l) => l.startsWith("WHO "))).toHaveLength(1);
		expect(opened.filter((l) => l.startsWith("MARKREAD "))).toEqual(["MARKREAD bob"]);

		// bob is offline: not known, but not worth querying again
		recv(":srv 315 me bob :End of WHO");
		await flush();
		app.switchBuffer(buf(app, SERVER_BUFFER)!.id);
		app.switchBuffer(buf(app, "bob")!.id);
		expect(await queries()).toEqual([]);
	});

	it("routes notices from unknown users to the server buffer", async () => {
		const { app, recv } = await connectedApp();
		recv(":bob!u@h NOTICE me :fyi");
		expect(buf(app, "bob")).toBeUndefined();
		expect(buf(app, SERVER_BUFFER)!.messages.at(-1)!.params[1]).toBe("fyi");
		recv(":srv NOTICE me :server notice");
		expect(buf(app, SERVER_BUFFER)!.messages.at(-1)!.params[1]).toBe("server notice");
	});

	it("routes channel context and STATUSMSG messages", async () => {
		const { app, recv } = await connectedApp({ isupport: "CHANTYPES=# STATUSMSG=@+ NETWORK=T" });
		recv(":me!u@h JOIN #c");
		recv("@+draft/channel-context=#c :ChanServ!u@h NOTICE me :welcome");
		expect(buf(app, "#c")!.messages.at(-1)!.params[1]).toBe("welcome");
		recv(":bob!u@h PRIVMSG @#c :ops only");
		expect(buf(app, "#c")!.messages.at(-1)!.params[1]).toBe("ops only");
	});

	it("shows QUIT and NICK in shared channels and queries", async () => {
		const { app, recv } = await connectedApp();
		recv(":me!u@h JOIN #c", ":bob!u@h JOIN #c", ":bob!u@h PRIVMSG me :hi");
		recv(":bob!u@h NICK robert");
		expect(buf(app, "#c")!.messages.at(-1)!.command).toBe("NICK");
		expect(buf(app, "bob")!.messages.at(-1)!.command).toBe("NICK");
		recv(":robert!u@h QUIT :bye");
		expect(buf(app, "#c")!.messages.at(-1)!.command).toBe("QUIT");
	});

	it("sends messages and echoes them locally without echo-message", async () => {
		const { app, recv, sent } = await connectedApp({ caps: "batch server-time" });
		recv(":me!u@h JOIN #c");
		app.switchBuffer(buf(app, "#c")!.id);
		sent();
		app.handleComposerSubmit("hello world");
		expect(sent()).toEqual(["PRIVMSG #c :hello world"]);
		expect(buf(app, "#c")!.messages.at(-1)!.params[1]).toBe("hello world");

		app.handleComposerSubmit("//not a command");
		expect(sent()).toEqual(["PRIVMSG #c :/not a command"]);
	});

	it("refuses to send messages in the server buffer", async () => {
		const { app } = await connectedApp();
		vi.spyOn(console, "error").mockImplementation(() => {});
		app.privmsg(SERVER_BUFFER, "x");
		expect(app.state.error).toBe("Cannot send message in server buffer");
	});

	it("reports server errors", async () => {
		const { app, recv } = await connectedApp();
		vi.spyOn(console, "error").mockImplementation(() => {});
		recv(":srv 482 me #c :You're not channel operator");
		expect(app.state.error).toBe("You're not channel operator");
		app.dismissError();
		expect(app.state.error).toBeNull();
	});

	it("closes channels and queries", async () => {
		const { app, recv, sent } = await connectedApp();
		recv(":me!u@h JOIN #c");
		recv(":bob!u@h PRIVMSG me :hi");
		app.switchBuffer(buf(app, "#c")!.id);
		sent();
		app.close(buf(app, "#c")!.id);
		expect(sent()).toContain("PART #c");
		expect(buf(app, "#c")).toBeUndefined();
		expect(app.state.activeBuffer).toBe(buf(app, SERVER_BUFFER)!.id);
		app.close(buf(app, "bob")!.id);
		expect(buf(app, "bob")).toBeUndefined();
		expect(app.bufferStore.get({ name: "bob", server: { url: "wss://irc.test/socket" } })?.closed).toBe(
			true,
		);
	});

	it("stores buffers marked as read without messages loaded", async () => {
		const { app, recv } = await connectedApp();
		recv(":me!u@h JOIN #c");
		app.setBufferState({ name: "#c" }, { messages: [], unread: Unread.HIGHLIGHT });
		app.bufferStore.put({
			name: "#c",
			server: { url: "wss://irc.test/socket" },
			unread: Unread.HIGHLIGHT,
		});
		app.markBufferAsRead(buf(app, "#c")!.id);
		expect(app.bufferStore.get({ name: "#c", server: { url: "wss://irc.test/socket" } })?.unread).toBe(
			Unread.NONE,
		);
	});

	it("returns to the connect form when the server is closed", async () => {
		const { app } = await connectedApp();
		app.disconnectAll();
		expect(app.state.servers.size).toBe(0);
		expect(app.state.connectForm).toBe(true);
	});

	it("restores open buffers after reconnecting", async () => {
		const first = await connectedApp();
		first.recv(":me!u@h JOIN #saved", ":carol!u@h PRIVMSG me :hi");
		first.app.bufferStore.saveImmediately();
		first.app.destroy();

		const second = await connectedApp({ register: false });
		second.recv(":srv CAP * LS :batch");
		second.recv(":srv 001 me :Welcome", ":srv 005 me CHANTYPES=# :ok");
		second.sent();
		second.recv(":srv 376 me :End");
		const sent = second.sent();
		expect(sent).toContain("JOIN #saved");
		expect(buf(second.app, "carol")).toBeDefined();
	});

	it("joins channels both restored and auto-joined once", async () => {
		const stored = new store.BufferStore();
		stored.put({ name: "#a", server: {} });
		stored.saveImmediately();
		stored.dispose();

		const { app, serverID, recv, sent } = await connectedApp({ register: false });
		app.clients.get(serverID)!.params.autojoin = ["#A", "#b"];
		recv(":srv CAP * LS :batch", ":srv 001 me :Welcome", ":srv 005 me CHANTYPES=# :ok");
		sent();
		recv(":srv 376 me :End");
		expect(sent().filter((l) => l.startsWith("JOIN "))).toEqual(["JOIN #a,#b"]);
	});

	it("joins many channels with several short enough JOINs", async () => {
		const stored = new store.BufferStore();
		const channels = Array.from(
			{ length: 20 },
			(_, i) => "#" + String(i).padStart(2, "0") + "x".repeat(40),
		);
		for (const name of channels) {
			stored.put({ name, server: {} });
		}
		stored.saveImmediately();
		stored.dispose();

		const register = async (isupport: string) => {
			const { recv, sent } = await connectedApp({ register: false });
			recv(":srv CAP * LS :batch", `:srv 001 me :Welcome`, `:srv 005 me CHANTYPES=# ${isupport} :ok`);
			sent();
			recv(":srv 376 me :End");
			return sent().filter((l) => l.startsWith("JOIN "));
		};
		const joins = await register("");
		expect(joins.length).toBeGreaterThan(1);
		expect(joins.every((l) => l.length <= 405)).toBe(true);
		expect(joins.flatMap((l) => l.slice(5).split(","))).toEqual(channels);

		expect(await register("TARGMAX=PRIVMSG:4,JOIN:3")).toHaveLength(7);
	});

	it("tab-completes commands, channels and members", async () => {
		const { app, recv } = await connectedApp();
		recv(":me!u@h JOIN #chan", ":bob!u@h JOIN #chan", ":bobby!u@h JOIN #chan");
		app.switchBuffer(buf(app, "#chan")!.id);
		expect(app.autocomplete("/jo")).toEqual(["/join"]);
		expect(app.autocomplete("#ch")).toEqual(["#chan"]);
		expect(app.autocomplete("bo")).toEqual(["bob", "bobby"]);

		// Not the channels of other servers
		app.update((state) => {
			const [id, update] = createServer(state);
			const [, buffers] = createBuffer({ ...state, ...update }, "#chat", id, app.getActiveClient()!);
			return { ...update, ...buffers };
		});
		expect(app.autocomplete("#ch")).toEqual(["#chan"]);
	});

	it("completes recent speakers first and our own nick last", async () => {
		const { app, recv } = await connectedApp({ nick: "mel" });
		recv(
			":mel!u@h JOIN #chan",
			":melissa!u@h JOIN #chan",
			":melvin!u@h JOIN #chan",
			":mo!u@h JOIN #chan",
			":melvin!u@h PRIVMSG #chan :first",
			":mo!u@h PRIVMSG #chan :later",
			":melissa!u@h PRIVMSG #chan :last",
		);
		app.switchBuffer(buf(app, "#chan")!.id);
		expect(app.autocomplete("me")).toEqual(["melissa", "melvin", "mel"]);
		expect(app.autocomplete("m")).toEqual(["melissa", "mo", "melvin", "mel"]);
	});

	it("opens irc:// URLs", async () => {
		const { app, recv } = await connectedApp();
		recv(":me!u@h JOIN #c");
		expect(app.openURL("https://example.org")).toBe(false);
		expect(app.openURL("irc:///%23c")).toBe(true);
		expect(app.state.activeBuffer).toBe(buf(app, "#c")!.id);
		expect(app.openURL("irc:///newnick,isuser")).toBe(true);
		expect(app.state.dialog).toMatchObject({ kind: "confirm-open-buffer", name: "newnick" });
	});

	it("switches to the channel a JOIN was forwarded to", async () => {
		const { app, recv } = await connectedApp();
		app.open("#old");
		recv(":srv 470 me #old ##new :Forwarding to another channel", ":me!u@h JOIN ##new");
		await flush();
		expect(app.state.activeBuffer).toBe(buf(app, "##new")!.id);
	});

	it("updates the window hash on buffer switch", async () => {
		const { app, recv } = await connectedApp();
		recv(":me!u@h JOIN #c");
		app.switchBuffer(buf(app, "#c")!.id);
		expect(window.location.hash).toBe("#/#c");
		app.switchBuffer(buf(app, SERVER_BUFFER)!.id);
		expect(window.location.hash).toBe("#/");
	});

	it("follows MARKREAD from other clients", async () => {
		const { app, recv } = await connectedApp();
		recv(":me!u@h JOIN #c");
		recv("@time=2030-01-01T00:00:00.000Z :bob!u@h PRIVMSG #c :one");
		recv("@time=2030-01-01T00:00:01.000Z :bob!u@h PRIVMSG #c :two");
		expect(buf(app, "#c")!.unread).toBe(Unread.MESSAGE);
		recv(":srv MARKREAD #c timestamp=2030-01-01T00:00:01.000Z");
		expect(buf(app, "#c")!.unread).toBe(Unread.NONE);
	});

	it("recomputes unread state on MARKREAD like for new messages", async () => {
		const { app, recv } = await connectedApp();
		recv(":me!u@h JOIN #c");
		recv("@time=2030-01-01T00:00:00.000Z :bob!u@h PRIVMSG me :one");
		recv("@time=2030-01-01T00:00:01.000Z :bob!u@h PRIVMSG me :two");
		expect(buf(app, "bob")!.unread).toBe(Unread.HIGHLIGHT);
		recv(":srv MARKREAD bob timestamp=2030-01-01T00:00:00.000Z");
		// Still a private message left
		expect(buf(app, "bob")!.unread).toBe(Unread.HIGHLIGHT);

		recv("@time=2030-01-01T00:00:00.000Z :bob!u@h PRIVMSG #c :one");
		recv("@time=2030-01-01T00:00:01.000Z :me!u@h PRIVMSG #c :mine");
		recv(":srv MARKREAD #c timestamp=2030-01-01T00:00:00.000Z");
		// Our own messages don't count
		expect(buf(app, "#c")!.unread).toBe(Unread.NONE);
	});

	it("keeps renamed channels and their stored state", async () => {
		const { app, recv } = await connectedApp();
		recv(":me!u@h JOIN #old");
		app.switchBuffer(buf(app, "#old")!.id);
		recv(":srv RENAME #old #new :merge");
		expect(buf(app, "#old")).toBeUndefined();
		expect(buf(app, "#new")!.messages.at(-1)!.command).toBe("RENAME");
		expect(window.location.hash).toBe("#/#new");
		expect(app.bufferStore.get({ name: "#new", server: { url: "wss://irc.test/socket" } })).toBeDefined();
		expect(
			app.bufferStore.get({ name: "#old", server: { url: "wss://irc.test/socket" } }),
		).toBeUndefined();
	});

	it("fetches NAMES lazily with no-implicit-names", async () => {
		const { app, recv, sent } = await connectedApp({ caps: "batch soju.im/no-implicit-names" });
		recv(":me!u@h JOIN #a", ":me!u@h JOIN #b");
		expect(sent()).toEqual([]);
		app.setBufferState({ name: "#b" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#b")!.id);
		expect(sent()).toEqual(["NAMES #b"]);
		recv(":srv 353 me = #b :@me bob", ":srv 366 me #b :End");
		expect([...buf(app, "#b")!.members.keys()]).toEqual(["me", "bob"]);
		app.switchBuffer(buf(app, SERVER_BUFFER)!.id);
		app.switchBuffer(buf(app, "#b")!.id);
		expect(sent()).toEqual([]);
	});

	it("fetches older messages on scroll", async () => {
		const { app, recv, sent, sentRaw } = await connectedApp();
		recv(":me!u@h JOIN #c", "@time=2030-01-02T00:00:00.000Z :bob!u@h PRIVMSG #c :new");
		app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#c")!.id);
		sent();
		const p = app.fetchOlderMessages();
		await flush();
		const [req] = sentRaw();
		expect(req).toMatch(/^@label=\d+ CHATHISTORY BEFORE #c timestamp=2030-01-02T00:00:00.000Z 100$/);
		const label = req.match(/label=(\d+)/)![1];
		recv(
			`@label=${label} :srv BATCH +h chathistory #c`,
			"@batch=h;time=2030-01-01T00:00:00.000Z;msgid=old :bob!u@h PRIVMSG #c :old",
			":srv BATCH -h",
		);
		expect(buf(app, "#c")!.history).toBe("loading");
		await p;
		expect(buf(app, "#c")!.history).toBe("end");
		expect(buf(app, "#c")!.messages.map((m) => m.params[1])).toEqual(["old", "new"]);
		// No more history: further scrolls are no-ops
		await app.fetchOlderMessages();
		expect(sent()).toEqual([]);
	});

	it("applies redactions found in older messages", async () => {
		const { app, recv, sent, sentRaw } = await connectedApp();
		recv(":me!u@h JOIN #c", "@time=2030-01-02T00:00:00.000Z :bob!u@h PRIVMSG #c :new");
		app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#c")!.id);
		sent();
		const p = app.fetchOlderMessages();
		await flush();
		const label = sentRaw()[0].match(/label=(\d+)/)![1];
		recv(
			`@label=${label} :srv BATCH +h chathistory #c`,
			"@batch=h;time=2030-01-01T00:00:00.000Z;msgid=old :bob!u@h PRIVMSG #c :oops",
			"@batch=h;time=2030-01-01T00:00:01.000Z;msgid=r :bob!u@h REDACT #c old",
			":srv BATCH -h",
		);
		await p;
		expect(buf(app, "#c")!.redacted.has("old")).toBe(true);
	});

	it("fetches older messages before a message ID when supported", async () => {
		const { app, recv, sent, sentRaw } = await connectedApp({
			isupport: "CASEMAPPING=rfc1459 CHANTYPES=# CHATHISTORY=100 MSGREFTYPES=timestamp,msgid",
		});
		recv(":me!u@h JOIN #c", "@time=2030-01-02T00:00:00.000Z;msgid=new :bob!u@h PRIVMSG #c :new");
		app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#c")!.id);
		sent();
		const p = app.fetchOlderMessages();
		await flush();
		const [req] = sentRaw();
		expect(req).toMatch(/ CHATHISTORY BEFORE #c msgid=new 100$/);
		recv(
			`@label=${req.match(/label=(\d+)/)![1]} :srv BATCH +h chathistory #c`,
			// Same time as the first message, but older
			"@batch=h;time=2030-01-02T00:00:00.000Z;msgid=old :bob!u@h PRIVMSG #c :old",
			":srv BATCH -h",
		);
		await p;
		expect(buf(app, "#c")!.messages.map((m) => m.params[1])).toEqual(["old", "new"]);
	});

	it("doesn't fetch history without CHATHISTORY ISUPPORT (soju bouncer connection)", async () => {
		const { app, recv, sent } = await connectedApp({
			caps: "batch server-time message-tags labeled-response draft/chathistory soju.im/bouncer-networks",
			isupport: "CASEMAPPING=ascii CHANTYPES= BOT=B",
		});
		recv(":BouncerServ!BouncerServ@BouncerServ PRIVMSG me :hi");
		app.switchBuffer(buf(app, "BouncerServ")!.id);
		sent();
		await app.fetchOlderMessages();
		expect(sent().filter((l) => l.startsWith("CHATHISTORY"))).toEqual([]);
		expect(buf(app, "BouncerServ")!.history).toBe("end");
	});

	it("waits for CHATHISTORY ISUPPORT on other servers", async () => {
		const { app, recv, sent } = await connectedApp({ isupport: "CASEMAPPING=rfc1459 CHANTYPES=#" });
		recv(":me!u@h JOIN #c");
		app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#c")!.id);
		sent();
		await app.fetchOlderMessages();
		expect(sent().filter((l) => l.startsWith("CHATHISTORY"))).toEqual([]);
		// ISUPPORT may come later: don't give up on history
		expect(buf(app, "#c")!.history).toBe("unknown");
	});

	it("keeps the client after /disconnect so that it can reconnect", async () => {
		const { app, serverID } = await connectedApp();
		app.disconnect(serverID);
		expect(app.state.servers.get(serverID)!.status).toBe("disconnected");
		app.reconnect(serverID);
		expect(app.state.servers.get(serverID)!.status).toBe("connecting");
		// Reconnecting resumes reconnecting after drops
		expect(app.clients.get(serverID)!.autoReconnect).toBe(true);
	});

	it("fetches older messages again after a disconnection interrupted them", async () => {
		const { app, ws, recv, sent } = await connectedApp();
		recv(":me!u@h JOIN #c");
		app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#c")!.id);
		sent();
		const p = app.fetchOlderMessages();
		await flush();
		vi.spyOn(console, "error").mockImplementation(() => {});
		ws.serverClose(1006);
		// Not an error: scrolling up fetches them again once reconnected
		await p;
		expect(buf(app, "#c")!.history).toBe("unknown");
		app.destroy();
	});

	it("ignores older messages of a server closed meanwhile", async () => {
		const { app, serverID, recv, sent } = await connectedApp();
		recv(":me!u@h JOIN #c");
		app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#c")!.id);
		sent();
		const p = app.fetchOlderMessages();
		await flush();
		const params = app.clients.get(serverID)!.params;
		app.close({ server: serverID, name: SERVER_BUFFER });
		await p;
		expect(app.state.error).toBeNull();
		expect(app.bufferStore.list(params)).toEqual([]);
	});

	it("stops fetching history after an error until retried", async () => {
		const { app, recv, sent, sentRaw } = await connectedApp();
		recv(":me!u@h JOIN #c");
		app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#c")!.id);
		sent();
		const p = app.fetchOlderMessages();
		await flush();
		const label = sentRaw()[0].match(/label=(\d+)/)![1];
		recv(`@label=${label} FAIL CHATHISTORY MESSAGE_ERROR #c :Messages could not be retrieved`);
		await expect(p).rejects.toThrow("Messages could not be retrieved");
		expect(buf(app, "#c")!.history).toBe("error");
		await app.fetchOlderMessages();
		expect(sent()).toEqual([]);
		void app.fetchOlderMessages(true);
		await flush();
		expect(sent()[0]).toMatch(/^CHATHISTORY BEFORE #c/);
	});

	it("shows reconnection status on disconnect", async () => {
		vi.useFakeTimers();
		const { app, ws, serverID, recv } = await connectedApp();
		recv(":me!u@h JOIN #c");
		vi.spyOn(console, "error").mockImplementation(() => {});
		ws.serverClose(1006);
		expect(app.state.servers.get(serverID)!.status).toBe("disconnected");
		expect(buf(app, "#c")!.joined).toBe(false);
		expect(app.state.error).toBe("Connection error (abnormal closure)");
		app.destroy();
	});
});

describe("dialogs", () => {
	it("authenticates from the auth dialog and saves credentials", async () => {
		const { app, recv, sent, serverID } = await connectedApp({ caps: "sasl=PLAIN batch" });
		store.autoconnect.put({ nick: "me", autoconnect: true });
		app.handleAuthClick(serverID);
		expect(app.state.dialog).toMatchObject({ kind: "auth", username: "me" });
		app.handleAuthSubmit(serverID, "me", "pw");
		expect(app.state.dialog).toMatchObject({ loading: true });
		expect(sent()).toContain("AUTHENTICATE PLAIN");
		recv(":srv 903 me :SASL authentication successful");
		await flush();
		expect(app.state.dialog).toBeNull();
		expect(store.autoconnect.load()?.saslPlain).toEqual({ username: "me", password: "pw" });
	});

	it("logs in again with the auth dialog's credentials after reconnecting", async () => {
		const { app, recv, sent, serverID } = await connectedApp({ caps: "sasl=PLAIN batch" });
		app.handleAuthSubmit(serverID, "me", "pw");
		recv(":srv 903 me :SASL authentication successful");
		await flush();
		// Not remembered, but kept for this session
		expect(store.autoconnect.load()).toBeNull();
		expect(app.clients.get(serverID)!.params.saslPlain).toEqual({ username: "me", password: "pw" });
		expect(app.state.connectParams.saslPlain).toEqual({ username: "me", password: "pw" });
		sent();
		app.disconnect(serverID);
		app.reconnect(serverID);
		const ws = FakeWebSocket.last();
		ws.open();
		ws.receive(":srv CAP * LS :sasl=PLAIN batch", ":srv CAP me ACK :sasl batch");
		expect(ws.sent).toContain("AUTHENTICATE PLAIN");
		expect(ws.sent).toContain("AUTHENTICATE AG1lAHB3");
	});

	it("logs in with a registered account once verified", async () => {
		const { app, recv, serverID } = await connectedApp({ caps: "draft/account-registration batch" });
		app.handleRegisterSubmit(serverID, "me@example.org", "pw");
		recv(":srv REGISTER VERIFICATION_REQUIRED me :Check your email");
		await flush();
		expect(app.state.dialog).toMatchObject({ kind: "verify", account: "me" });
		expect(app.clients.get(serverID)!.params.saslPlain).toBeFalsy();
		app.handleVerifySubmit(serverID, "me", "123");
		recv(":srv VERIFY SUCCESS me :Account verified");
		await flush();
		expect(app.state.dialog).toBeNull();
		expect(app.clients.get(serverID)!.params.saslPlain).toEqual({ username: "me", password: "pw" });
	});

	it("shows failures and stops loading", async () => {
		const { app, recv, serverID } = await connectedApp({ caps: "sasl=PLAIN batch" });
		vi.spyOn(console, "error").mockImplementation(() => {});
		app.handleAuthSubmit(serverID, "me", "bad");
		app.openDialog({ kind: "auth", server: serverID, username: "me", loading: true });
		recv(":srv 904 me :SASL authentication failed");
		await flush();
		expect(app.state.error).toBe("SASL authentication failed");
		expect(app.state.dialog).toMatchObject({ loading: false });
	});

	it("applies the theme from settings", async () => {
		const app = new AppController();
		app.handleSettingsChange({ theme: "zenburn" });
		expect(document.documentElement.dataset.theme).toBe("zenburn");
		document.documentElement.removeAttribute("data-theme");
		new AppController();
		expect(document.documentElement.dataset.theme).toBe("zenburn");
		app.handleSettingsChange({ theme: "system" });
		expect(document.documentElement.dataset.theme).toBeUndefined();
	});

	it("persists settings", async () => {
		const app = new AppController();
		app.handleSettingsChange({ secondsInTimestamps: false });
		expect(app.state.settings.secondsInTimestamps).toBe(false);
		expect(new AppController().state.settings.secondsInTimestamps).toBe(false);
	});
});

describe("reactions, replies, redaction and typing", () => {
	async function chat(caps?: string) {
		const h = await connectedApp(caps ? { caps } : {});
		h.recv(":me!u@h JOIN #c");
		h.app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		h.app.switchBuffer(buf(h.app, "#c")!.id);
		h.recv("@msgid=m1;time=2030-01-01T00:00:00.000Z :bob!u@h PRIVMSG #c :hello");
		h.sent();
		return { ...h, id: buf(h.app, "#c")!.id, msg: buf(h.app, "#c")!.messages.at(-1)! };
	}

	it("applies reactions from other users, including in queries", async () => {
		const { app, recv } = await chat();
		recv("@+draft/react=👍;+draft/reply=m1 :bob!u@h TAGMSG #c");
		recv("@+draft/react=👍;+draft/reply=m1 :carol!u@h TAGMSG #c");
		expect(buf(app, "#c")!.reactions.get("m1")!.get("👍")).toEqual(["bob", "carol"]);
		recv("@+draft/unreact=👍;+draft/reply=m1 :bob!u@h TAGMSG #c");
		expect(buf(app, "#c")!.reactions.get("m1")!.get("👍")).toEqual(["carol"]);

		recv("@msgid=d1 :dave!u@h PRIVMSG me :hi", "@+draft/react=🎉;+draft/reply=d1 :dave!u@h TAGMSG me");
		expect(buf(app, "dave")!.reactions.get("d1")!.get("🎉")).toEqual(["dave"]);
	});

	it("toggles our own reactions", async () => {
		const { app, recv, sentRaw, id, msg } = await chat();
		app.react(id, msg, "❤️");
		expect(sentRaw()).toEqual(["@+draft/react=❤️;+draft/reply=m1 TAGMSG #c"]);
		recv("@+draft/react=❤️;+draft/reply=m1 :me!u@h TAGMSG #c");
		app.react(id, buf(app, "#c")!.messages.at(-1)!, "❤️");
		expect(sentRaw()).toEqual(["@+draft/unreact=❤️;+draft/reply=m1 TAGMSG #c"]);
	});

	it("applies reactions locally without echo-message", async () => {
		const { app, id, msg } = await chat("batch server-time message-tags");
		app.react(id, msg, "👍");
		expect(buf(app, "#c")!.reactions.get("m1")!.get("👍")).toEqual(["me"]);
	});

	it("sends replies with the reply tag", async () => {
		const { app, sentRaw, id, msg } = await chat();
		app.startReply(id, msg);
		expect(app.state.replyTo).toEqual({ buffer: id, msgid: "m1", nick: "bob", text: "hello" });
		app.handleComposerSubmit("hi bob");
		expect(sentRaw()).toEqual(["@+draft/reply=m1 PRIVMSG #c :hi bob"]);
		expect(app.state.replyTo).toBeNull();
	});

	it("refuses to send while disconnected, keeping the reply", async () => {
		const { app, id, msg } = await chat();
		app.startReply(id, msg);
		app.disconnect();
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(app.handleComposerSubmit("hi bob")).toBe(false);
		expect(app.state.error).toBe("Not connected to the server");
		expect(app.state.replyTo).not.toBeNull();
		for (const action of [
			() => app.react(id, msg, "👍"),
			() => app.redact(id, msg),
			() => app.handleJoinClick(buf(app, "#c")!),
		]) {
			app.dismissError();
			action();
			expect(app.state.error).toBe("Not connected to the server");
		}
	});

	it("cancels a reply when switching buffers", async () => {
		const { app, id, msg } = await chat();
		app.startReply(id, msg);
		app.switchBuffer(buf(app, SERVER_BUFFER)!.id);
		expect(app.state.replyTo).toBeNull();
	});

	it("doesn't send client tags the server denies", async () => {
		const h = await connectedApp({
			isupport: "CHANTYPES=# CLIENTTAGDENY=*,-typing NETWORK=T",
		});
		expect(h.app.canReact(h.serverID)).toBe(false);
		expect(h.app.canReply(h.serverID)).toBe(false);
		expect(h.app.canSendClientTag(h.app.getClient(h.serverID), "typing")).toBe(true);
	});

	it("deletes messages", async () => {
		const { app, recv, sent, id, msg } = await chat(
			"batch server-time echo-message message-tags draft/message-redaction",
		);
		expect(app.canRedact(app.state.servers.keys().next().value!)).toBe(true);
		app.redact(id, msg);
		expect(sent()).toEqual(["REDACT #c m1"]);
		recv(":me!u@h REDACT #c m1");
		expect(buf(app, "#c")!.redacted.has("m1")).toBe(true);
	});

	it("doesn't share typing when turned off, but ends ongoing typing", async () => {
		const { app, sentRaw } = await chat();
		app.notifyTyping("h");
		expect(sentRaw()).toEqual(["@+typing=active TAGMSG #c"]);
		app.handleSettingsChange({ sendTyping: false });
		app.notifyTyping("he");
		expect(sentRaw()).toEqual(["@+typing=done TAGMSG #c"]);
		app.notifyTyping("hel");
		app.notifyTyping("");
		expect(sentRaw()).toEqual([]);
	});

	it("applies the message text size without resizing the interface", () => {
		const app = new AppController();
		app.handleSettingsChange({ messageTextSize: 20 });
		expect(document.documentElement.style.getPropertyValue("--chat-font-size")).toBe("20px");
		app.handleSettingsChange({ messageTextSize: 15 });
		expect(document.documentElement.style.getPropertyValue("--chat-font-size")).toBe("15px");
		app.handleSettingsChange({ messagesFont: "jetbrains-mono" });
		expect(document.documentElement.style.getPropertyValue("--messages-font")).toContain(
			"JetBrains Mono",
		);
		expect(document.documentElement.style.fontSize).toBe("");
	});

	it("sends throttled typing notifications", async () => {
		vi.useFakeTimers();
		const { app, sentRaw } = await chat();
		app.notifyTyping("h");
		app.notifyTyping("he");
		expect(sentRaw()).toEqual(["@+typing=active TAGMSG #c"]);
		vi.advanceTimersByTime(3000);
		app.notifyTyping("hel");
		// Ignore the lag check, sent meanwhile
		expect(sentRaw().filter((l) => !l.startsWith("PING "))).toEqual(["@+typing=active TAGMSG #c"]);
		app.notifyTyping("");
		expect(sentRaw()).toEqual(["@+typing=done TAGMSG #c"]);
		app.notifyTyping("");
		app.notifyTyping("/join");
		expect(sentRaw()).toEqual([]);
		// Sending a message resets the state without an explicit done
		app.notifyTyping("x");
		app.handleComposerSubmit("x");
		app.notifyTyping("");
		expect(sentRaw()).toEqual(["@+typing=active TAGMSG #c", "PRIVMSG #c x"]);
	});

	it("shows and clears typing from other users", async () => {
		const { app, recv } = await chat();
		recv("@+typing=active :bob!u@h TAGMSG #c");
		expect([...buf(app, "#c")!.typing.keys()]).toEqual(["bob"]);
		recv(":bob!u@h PRIVMSG #c :done typing");
		expect(buf(app, "#c")!.typing.size).toBe(0);
		recv("@+typing=active :me!u@h TAGMSG #c");
		expect(buf(app, "#c")!.typing.size).toBe(0);
	});
});

describe("bouncer networks", () => {
	it("keeps the network dialog open when the bouncer rejects a change", async () => {
		const { app, recv, sentRaw } = await connectedApp({
			caps: "batch server-time message-tags labeled-response soju.im/bouncer-networks",
		});
		sentRaw();
		app.openDialog({ kind: "network", id: "1" });
		const p = app.handleNetworkSubmit("1", { host: "bad host" }, null);
		await flush();
		const req = sentRaw().find((l) => l.includes("CHANGENETWORK"))!;
		expect(req).toMatch(/BOUNCER CHANGENETWORK 1 host=bad\\shost$/);
		vi.spyOn(console, "error").mockImplementation(() => {});
		recv(
			`@label=${req.match(/label=(\d+)/)![1]} FAIL BOUNCER INVALID_ATTRIBUTE CHANGENETWORK 1 host :Invalid host`,
		);
		await p;
		expect(app.state.dialog).toMatchObject({ kind: "network" });
		expect(app.state.error).toBe("Invalid host");
	});
});

describe("opening irc:// URLs", () => {
	it("opens URLs with a port on the existing bouncer network", async () => {
		const { app, recv } = await connectedApp({
			caps: "batch server-time message-tags labeled-response soju.im/bouncer-networks",
		});
		app.autoOpenURL = irc.parseURL("ircs://irc.libera.chat:6697/#soju");
		recv(
			":srv BATCH +n soju.im/bouncer-networks",
			"@batch=n :srv BOUNCER NETWORK 1 name=Libera;host=irc.libera.chat;state=connected",
			":srv BATCH -n",
		);
		// Not offered to add a network: opened once its connection is registered
		expect(app.state.dialog).toBeNull();
		expect(app.autoOpenURL).not.toBeNull();
	});
});

describe("detaching channels", () => {
	it("detaches through BouncerServ without opening its buffer", async () => {
		const { app, recv, sentRaw } = await connectedApp({
			isupport: "CASEMAPPING=rfc1459 CHANTYPES=# BOUNCER_NETID=1 CHATHISTORY=100",
		});
		recv(":me!u@h JOIN #c");
		sentRaw();
		const p = app.detachChannel(buf(app, "#c")!.id);
		const [req] = sentRaw();
		expect(req).toMatch(/PRIVMSG BouncerServ :channel update #c -detached true$/);
		const label = req.match(/label=(\d+)/)![1];
		recv(
			`@label=${label} :srv BATCH +l labeled-response`,
			"@batch=l :me!u@h PRIVMSG BouncerServ :channel update #c -detached true",
			"@batch=l :BouncerServ!BouncerServ@BouncerServ PRIVMSG me :updated channel #c",
			":srv BATCH -l",
			":me!u@h PART #c :Detach",
		);
		await p;
		expect(buf(app, "BouncerServ")).toBeUndefined();
		expect(buf(app, "#c")!.joined).toBe(false);
	});

	it("reports BouncerServ errors and requires soju", async () => {
		const { app, recv, sentRaw } = await connectedApp({
			isupport: "CASEMAPPING=rfc1459 CHANTYPES=# BOUNCER_NETID=1",
		});
		recv(":me!u@h JOIN #c");
		sentRaw();
		const p = app.detachChannel(buf(app, "#c")!.id);
		const label = sentRaw()[0].match(/label=(\d+)/)![1];
		recv(`@label=${label} :BouncerServ!BouncerServ@BouncerServ PRIVMSG me :error: unknown channel`);
		await expect(p).rejects.toThrow("error: unknown channel");

		const plain = await connectedApp();
		plain.recv(":me!u@h JOIN #c");
		await expect(plain.app.detachChannel(buf(plain.app, "#c")!.id)).rejects.toThrow(/soju/);
	});
});

describe("soju metadata", () => {
	const caps =
		"batch server-time echo-message message-tags labeled-response draft/chathistory draft/metadata-2";
	const isupport = "CASEMAPPING=rfc1459 CHANTYPES=# BOUNCER_NETID=1 CHATHISTORY=100";

	it("subscribes, follows updates and sets values", async () => {
		const { app, recv, sent, serverID } = await connectedApp({ caps, isupport, register: false });
		recv(`:srv CAP * LS :${caps}`, `:srv CAP me ACK :${caps}`);
		recv(":srv 001 me :Welcome", `:srv 005 me ${isupport} :are supported`, ":srv 376 me :End of MOTD");
		expect(sent()).toContain("METADATA * SUB soju.im/pinned soju.im/muted soju.im/blocked");
		recv(":srv METADATA #c soju.im/pinned * 1", ":srv 761 me bob soju.im/blocked * 1");
		const server = app.state.servers.get(serverID)!;
		expect(server.metadata.get("#C")).toEqual({ pinned: true });
		expect(server.metadata.get("bob")).toEqual({ blocked: true });
		recv(":srv METADATA #c soju.im/pinned * 0");
		expect(app.state.servers.get(serverID)!.metadata.get("#c")).toEqual({ pinned: false });
		// Not shown anywhere
		expect(buf(app, SERVER_BUFFER)!.messages.some((m) => m.command === "METADATA")).toBe(false);

		recv(":me!u@h JOIN #c");
		app.switchBuffer(buf(app, "#c")!.id);
		sent();
		app.handleComposerSubmit("/mute");
		app.handleComposerSubmit("/block bob");
		app.handleComposerSubmit("/unpin #other");
		expect(sent()).toEqual([
			"METADATA #c SET soju.im/muted 1",
			"METADATA bob SET soju.im/blocked 1",
			"METADATA #other SET soju.im/pinned 0",
		]);
	});

	it("ignores blocked users and keeps muted buffers quiet", async () => {
		const { app, recv } = await connectedApp({ caps, isupport });
		recv(":srv METADATA troll soju.im/blocked * 1", ":srv METADATA #quiet soju.im/muted * 1");
		recv("@time=2030-01-01T00:00:00.000Z :troll!u@h PRIVMSG me :spam");
		expect(buf(app, "troll")).toBeUndefined();
		recv(":me!u@h JOIN #quiet");
		recv("@time=2030-01-01T00:00:01.000Z :bob!u@h PRIVMSG #quiet :me: ping");
		expect(buf(app, "#quiet")!.unread).toBe(Unread.MESSAGE);
	});

	it("requires soju", async () => {
		const { app, serverID } = await connectedApp();
		expect(() => app.setTargetMetadata(serverID, "#c", "pinned", true)).toThrow(/soju/);
	});
});

describe("search", () => {
	it("searches and jumps to results, loading context", async () => {
		const { app, recv, sentRaw, serverID } = await connectedApp({
			caps: "batch server-time echo-message message-tags labeled-response draft/chathistory soju.im/search",
		});
		recv(":me!u@h JOIN #c");
		app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#c")!.id);
		app.openSearch("buffer", "needle");
		expect(app.state.dialog).toEqual({ kind: "search", server: serverID, buffer: "#c", query: "needle" });
		sentRaw();

		const p = app.searchMessages(serverID, { text: "needle", in: "#c" });
		const [req] = sentRaw();
		expect(req).toMatch(/^@label=(\d+) SEARCH text=needle;in=#c;limit=100$/);
		const label = req.match(/label=(\d+)/)![1];
		recv(
			`@label=${label} :srv BATCH +s soju.im/search`,
			"@batch=s;msgid=a;time=2020-01-01T00:00:00.000Z :bob!u@h PRIVMSG #c :old needle",
			"@batch=s;msgid=b;time=2020-01-02T00:00:00.000Z :bob!u@h PRIVMSG me :dm needle",
			":srv BATCH -s",
		);
		const results = await p;
		expect(results.map((r) => [r.buffer, r.message.tags.msgid])).toEqual([
			["bob", "b"],
			["#c", "a"],
		]);
		// Search results aren't displayed as new messages
		expect(buf(app, "#c")!.messages).toHaveLength(0);
		expect(buf(app, "bob")).toBeUndefined();

		const jump = app.jumpToMessage(serverID, "#c", "a", "2020-01-01T00:00:00.000Z");
		await flush();
		// Like soju, the server only takes timestamps without MSGREFTYPES=msgid
		const around = sentRaw().find((l) => l.includes("CHATHISTORY"))!;
		expect(around).toMatch(/CHATHISTORY AROUND #c timestamp=2020-01-01T00:00:00.000Z 50$/);
		const label2 = around.match(/label=(\d+)/)![1];
		recv(
			`@label=${label2} :srv BATCH +h chathistory #c`,
			"@batch=h;msgid=a;time=2020-01-01T00:00:00.000Z :bob!u@h PRIVMSG #c :old needle",
			":srv BATCH -h",
		);
		await jump;
		expect(buf(app, "#c")!.messages.some((m) => m.tags.msgid === "a")).toBe(true);
		expect(app.state.jumpTo).toEqual({ buffer: buf(app, "#c")!.id, msgid: "a" });
	});

	it("sorts results newest first, keeping the order of those with the same time", async () => {
		const { app, serverID } = await connectedApp();
		const msg = (msgid: string, time: string) =>
			irc.parseMessage(`@msgid=${msgid};time=${time} :bob!u@h PRIVMSG #c :x`);
		const t = "2020-01-01T00:00:00.000Z";
		const same = Array.from({ length: 30 }, (_, i) => msg(`s${i}`, t));
		vi.spyOn(app.clients.get(serverID)!, "search").mockResolvedValue([
			...same,
			msg("new", "2020-01-02T00:00:00.000Z"),
		]);
		const results = await app.searchMessages(serverID, { text: "x" });
		expect(results.map((r) => r.message.tags.msgid)).toEqual(["new", ...same.map((m) => m.tags.msgid)]);
	});

	it("searches each buffer when the server requires a target (soju)", async () => {
		const { app, recv, sentRaw, serverID } = await connectedApp({
			caps: "batch server-time echo-message message-tags labeled-response draft/chathistory soju.im/search",
		});
		recv(":me!u@h JOIN #a", ":me!u@h JOIN #b");
		sentRaw();
		const p = app.searchMessages(serverID, { text: "x" });
		await flush();
		const first = sentRaw().find((l) => l.includes("SEARCH"))!;
		expect(first).toMatch(/SEARCH text=x;limit=100$/);
		recv(
			`@label=${first.match(/label=(\d+)/)![1]} FAIL SEARCH INVALID_PARAMS in :The in parameter is mandatory`,
		);
		for (const [target, msgid] of [
			["#a", "m1"],
			["#b", "m2"],
		]) {
			await flush();
			const req = sentRaw().find((l) => l.includes("SEARCH"))!;
			expect(req).toMatch(new RegExp(`SEARCH text=x;in=${target};limit=100$`));
			recv(
				`@label=${req.match(/label=(\d+)/)![1]} :srv BATCH +${msgid} soju.im/search`,
				`@batch=${msgid};msgid=${msgid};time=2020-01-01T00:00:00.000Z :bob!u@h PRIVMSG ${target} :x`,
				`:srv BATCH -${msgid}`,
			);
		}
		const results = await p;
		expect(results.map((r) => r.buffer).sort()).toEqual(["#a", "#b"]);
		// Handled by the search: not shown as an error too
		expect(app.state.error).toBeNull();
	});

	it("doesn't search without server support", async () => {
		const { app } = await connectedApp();
		vi.spyOn(console, "error").mockImplementation(() => {});
		app.openSearch();
		expect(app.state.dialog).toBeNull();
		expect(app.state.error).toMatch(/doesn't support searching/);
	});
});

describe("AppController presence", () => {
	function setVisibility(state: DocumentVisibilityState) {
		Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
		document.dispatchEvent(new Event("visibilitychange"));
	}

	it("goes away once the page stays hidden, with draft/pre-away", async () => {
		const { app, sent } = await connectedApp({ caps: "batch draft/pre-away" });
		const detach = app.attach();
		vi.useFakeTimers();
		try {
			setVisibility("hidden");
			setVisibility("visible");
			setVisibility("hidden");
			vi.advanceTimersByTime(59 * 1000);
			expect(sent()).toEqual([]);
			vi.advanceTimersByTime(1000);
			expect(sent()).toEqual(["AWAY *"]);
			setVisibility("visible");
			expect(sent()).toEqual(["AWAY"]);
		} finally {
			setVisibility("visible");
			detach();
			vi.useRealTimers();
		}
	});

	it("follows the auto-away delay setting", async () => {
		const { app, sent } = await connectedApp({ caps: "batch draft/pre-away" });
		const detach = app.attach();
		vi.useFakeTimers();
		try {
			app.handleSettingsChange({ autoAwayMinutes: 0 });
			setVisibility("hidden");
			vi.advanceTimersByTime(60 * 60 * 1000);
			expect(sent()).toEqual([]);
			app.handleSettingsChange({ autoAwayMinutes: 5 });
			vi.advanceTimersByTime(5 * 60 * 1000);
			expect(sent()).toEqual(["AWAY *"]);
			app.handleSettingsChange({ autoAwayMinutes: 0 });
			expect(sent()).toEqual(["AWAY"]);
		} finally {
			app.handleSettingsChange({ autoAwayMinutes: 1 });
			setVisibility("visible");
			detach();
			vi.useRealTimers();
		}
	});
});

describe("AppController buffer list", () => {
	it("collapses networks and remembers it", async () => {
		const { app, serverID } = await connectedApp();
		try {
			app.toggleCollapsed(serverID);
			expect(app.state.collapsedNetworks).toEqual(new Set([""]));
			expect(store.collapsedNetworks.load()).toEqual([""]);
			expect(new AppController().state.collapsedNetworks).toEqual(new Set([""]));
			app.toggleCollapsed(serverID, true);
			expect(app.state.collapsedNetworks).toEqual(new Set());
		} finally {
			localStorage.clear();
		}
	});
});

describe("AppController notifications", () => {
	function stubNotifications(bodies: string[] = []) {
		const shown: string[] = [];
		class FakeNotification extends EventTarget {
			static permission = "granted";
			constructor(title: string, options?: NotificationOptions) {
				super();
				shown.push(title);
				bodies.push(options?.body ?? "");
			}
		}
		vi.stubGlobal("Notification", FakeNotification);
		return shown;
	}

	it("notifies of mentions, all messages or nothing", async () => {
		const shown = stubNotifications();
		let t = Date.UTC(2040, 0, 1);
		const at = (line: string) => `@time=${new Date(t++).toISOString()} ${line}`;
		try {
			const { app, recv } = await connectedApp({ caps: "batch server-time message-tags" });
			recv(":me!u@h JOIN #c");
			recv(at(":bob!u@h PRIVMSG #c :hello all"), at(":bob!u@h PRIVMSG #c :hi me"));
			expect(shown).toEqual(["New highlight from bob in #c"]);

			app.handleSettingsChange({ notifications: "all" });
			recv(at(":bob!u@h PRIVMSG #c :hello again"));
			expect(shown.at(-1)).toBe("New message from bob in #c");

			app.handleSettingsChange({ notifications: "none" });
			recv(
				at(":bob!u@h PRIVMSG #c :me?"),
				at(":bob!u@h PRIVMSG me :psst"),
				at(":bob!u@h INVITE me #secret"),
			);
			expect(shown).toHaveLength(2);
		} finally {
			localStorage.clear();
			vi.unstubAllGlobals();
		}
	});

	it("notifies of actions, not of other CTCPs", async () => {
		const bodies: string[] = [];
		const shown = stubNotifications(bodies);
		try {
			const { recv } = await connectedApp({ caps: "batch server-time message-tags" });
			recv(
				"@time=2040-01-01T00:00:00.000Z :bob!u@h PRIVMSG me :\x01VERSION\x01",
				"@time=2040-01-01T00:00:01.000Z :bob!u@h PRIVMSG me :\x01ACTION waves\x01",
			);
			expect(shown).toEqual(["New private message from bob"]);
			expect(bodies).toEqual(["* bob waves"]);
		} finally {
			localStorage.clear();
			vi.unstubAllGlobals();
		}
	});

	it("doesn't notify for the buffer being read", async () => {
		const shown = stubNotifications();
		const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
		let t = Date.UTC(2040, 0, 1);
		const at = (line: string) => `@time=${new Date(t++).toISOString()} ${line}`;
		const { app, recv } = await connectedApp({ caps: "batch server-time message-tags" });
		recv(":me!u@h JOIN #c", ":me!u@h JOIN #d");
		app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#c")!.id);
		recv(at(":bob!u@h PRIVMSG #c :hi me"));
		expect(shown).toEqual([]);
		expect(buf(app, "#c")!.unread).toBe(Unread.NONE);
		recv(at(":bob!u@h PRIVMSG #d :hi me"));
		expect(shown).toEqual(["New highlight from bob in #d"]);
		hasFocus.mockReturnValue(false);
		recv(at(":bob!u@h PRIVMSG #c :me again"));
		expect(shown).toHaveLength(2);
	});

	it("doesn't mark messages read while scrolled up", async () => {
		vi.spyOn(document, "hasFocus").mockReturnValue(true);
		const { app, recv, sent } = await connectedApp();
		recv(":me!u@h JOIN #c");
		app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#c")!.id);
		sent();
		app.handleScrolledToLatest(false);
		recv("@time=2030-01-01T00:00:00.000Z :bob!u@h PRIVMSG #c :new");
		expect(buf(app, "#c")!.unread).toBe(Unread.MESSAGE);
		expect(sent().filter((l) => l.startsWith("MARKREAD"))).toEqual([]);
		app.handleWindowFocus();
		expect(sent().filter((l) => l.startsWith("MARKREAD"))).toEqual([]);

		app.handleScrolledToLatest(true);
		expect(buf(app, "#c")!.unread).toBe(Unread.NONE);
		expect(sent()).toContain("MARKREAD #c timestamp=2030-01-01T00:00:00.000Z");
	});

	it("keeps the latest messages of long buffers, unless reading older ones", async () => {
		const { app, recv } = await connectedApp();
		recv(":me!u@h JOIN #c", ":me!u@h JOIN #d");
		app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#c")!.id);
		const lines = (chan: string, n: number, from = 0) =>
			Array.from(
				{ length: n },
				(_, i) =>
					`@time=${new Date(Date.UTC(2030, 0, 1) + from + i).toISOString()} :bob!u@h PRIVMSG ${chan} :${i}`,
			);
		recv(...lines("#d", S.MAX_MESSAGES + 5));
		expect(buf(app, "#d")!.messages).toHaveLength(S.MAX_MESSAGES);
		expect(buf(app, "#d")!.messages[0].params[1]).toBe("5");
		// Scrolling up fetches them again
		expect(buf(app, "#d")!.history).toBe("more");

		app.handleScrolledToLatest(false);
		recv(...lines("#c", S.MAX_MESSAGES + 5));
		expect(buf(app, "#c")!.messages).toHaveLength(S.MAX_MESSAGES + 5);
		app.handleScrolledToLatest(true);
		expect(buf(app, "#c")!.messages).toHaveLength(S.MAX_MESSAGES);

		// Left scrolled up: trimmed once another buffer is active
		app.handleScrolledToLatest(false);
		recv(...lines("#c", 10, 1e6));
		expect(buf(app, "#c")!.messages).toHaveLength(S.MAX_MESSAGES + 10);
		app.switchBuffer(buf(app, "#d")!.id);
		expect(buf(app, "#c")!.messages).toHaveLength(S.MAX_MESSAGES);
	});

	it("keeps messages without history to fetch them again from", () => {
		const t = { history: "end", gap: null } as const;
		const messages = Array.from({ length: S.MAX_MESSAGES + 1 }, () => ({}) as irc.Message);
		expect(S.trimMessages({ ...t, messages } as unknown as Buffer, false)).toEqual({
			messages: messages.slice(1),
		});
		expect(
			S.trimMessages({ ...t, messages, history: "loading" } as unknown as Buffer, true),
		).toBeUndefined();
	});
});

describe("AppController with several servers", () => {
	/** Connect to another server, feeding it the given lines once registered. */
	function connectAnother(app: AppController, ...lines: string[]): number {
		const serverID = app.connect({ nick: "me", url: "wss://irc.test/socket" });
		const ws = FakeWebSocket.last();
		ws.open();
		ws.receive(":srv CAP * LS :batch", ":srv 001 me :Welcome", ":srv 005 me CHANTYPES=# :ok");
		ws.receive(":srv 376 me :End", ...lines);
		return serverID;
	}

	const openBuffer = (app: AppController, target: string) =>
		app.handleWorkerMessage({ type: "open-buffer", target });
	const active = (app: AppController) => getBuffer(app.state, app.state.activeBuffer)!;

	it("opens push notifications on the active server first, without joining", async () => {
		const { app, recv, serverID, sent } = await connectedApp();
		recv(":me!u@h JOIN #c");
		const second = connectAnother(app, ":me!u@h JOIN #c", ":me!u@h JOIN #d", ":me!u@h JOIN #e");
		const third = connectAnother(app, ":me!u@h JOIN #e", ":bob!u@h PRIVMSG #e :hi me");
		vi.spyOn(console, "warn").mockImplementation(() => {});
		sent();

		openBuffer(app, "#C");
		expect(active(app)).toMatchObject({ server: serverID, name: "#c" });
		app.switchBuffer({ server: second, name: "#d" });
		openBuffer(app, "#c");
		expect(active(app)).toMatchObject({ server: second, name: "#c" });
		// Not on the active server: the one with a highlight
		app.switchBuffer({ server: serverID, name: "#c" });
		openBuffer(app, "#e");
		expect(active(app)).toMatchObject({ server: third, name: "#e" });

		openBuffer(app, "#unknown");
		expect(active(app)).toMatchObject({ server: third, name: "#e" });
		expect(sent()).toEqual([]);
	});

	it("looks for hash routes without a host on all servers", async () => {
		const { app } = await connectedApp();
		const second = connectAnother(app, ":me!u@h JOIN #d");
		window.history.replaceState(null, "", "#/#d");
		app.handleWindowHashChange();
		expect(active(app)).toMatchObject({ server: second, name: "#d" });
		window.history.replaceState(null, "", "/");
	});

	it("keeps an initial route without a host until a server has its buffer", async () => {
		const pong = async (ws: FakeWebSocket) => {
			const ping = ws.sent.find((l) => l.startsWith("PING "))!;
			ws.receive(`:srv PONG srv ${ping.split(" ")[1]}`);
			await flush();
		};
		window.history.replaceState(null, "", "/#/#d");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { app, ws } = await connectedApp({ register: false });
		ws.receive(":srv CAP * LS :batch", ":srv 001 me :Welcome", ":srv 005 me CHANTYPES=# :ok");
		ws.receive(":srv 376 me :End");
		await pong(ws);
		expect(app.initialRoute).not.toBeNull();

		const second = connectAnother(app, ":me!u@h JOIN #d");
		await pong(FakeWebSocket.last());
		expect(active(app)).toMatchObject({ server: second, name: "#d" });
		expect(app.initialRoute).toBeNull();
		window.history.replaceState(null, "", "/");
	});
});

describe("AppController chat history", () => {
	const caps =
		"batch server-time echo-message message-tags labeled-response draft/chathistory draft/read-marker";

	/** Connect with a stored #c buffer, so that its backlog gets fetched. */
	async function withBacklog({ backlogSize = 100 as number | null, chathistory = 100 } = {}) {
		const t = "2030-01-01T00:00:00.000Z";
		// null: no stored setting, the default applies
		if (backlogSize !== null) {
			localStorage.setItem("gamja_settings", JSON.stringify({ backlogSize }));
		}
		localStorage.setItem(
			"gamja_buffers",
			JSON.stringify({
				[JSON.stringify({ name: "#c", server: {} })]: {
					name: "#c",
					unread: Unread.NONE,
					closed: false,
					server: {},
					receipts: { delivered: { time: t }, read: { time: t } },
				},
			}),
		);
		const h = await connectedApp({ register: false });
		h.recv(`:srv CAP * LS :${caps}`, `:srv CAP me ACK :${caps}`);
		h.recv(
			":srv 001 me :Welcome",
			`:srv 005 me CHANTYPES=# CHATHISTORY=${chathistory} :ok`,
			":srv 376 me :End",
		);
		// Queued behind other CHATHISTORY requests
		await flush();
		const targets = h.sentRaw().find((l) => l.includes("CHATHISTORY TARGETS"))!;
		const reply = (req: string, type: string, ...lines: string[]) => {
			const label = req.match(/label=(\d+)/)![1];
			h.recv(
				`@label=${label} :srv BATCH +b ${type}`,
				...lines.map((l) => `@batch=b;${l}`),
				":srv BATCH -b",
			);
		};
		/** Answer the TARGETS request, returns the BETWEEN request for #c */
		const replyTargets = async () => {
			reply(
				targets,
				"draft/chathistory-targets",
				":srv CHATHISTORY TARGETS #c 2030-01-02T00:00:00.000Z",
			);
			await flush();
			return h.sentRaw().find((l) => l.includes("CHATHISTORY BETWEEN"))!;
		};
		return { ...h, reply, replyTargets };
	}

	it("applies the backlog with a single read marker for the buffer being read", async () => {
		vi.spyOn(document, "hasFocus").mockReturnValue(true);
		const { app, recv, sent, reply, replyTargets } = await withBacklog();
		recv(":me!u@h JOIN #c");
		app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#c")!.id);
		sent();

		const between = await replyTargets();
		// The latest missed messages: the later bound goes first
		expect(between).toMatch(/BETWEEN #c timestamp=\S+ timestamp=2030-01-01T00:00:00.000Z 100$/);
		const updates = vi.fn();
		const unsubscribe = app.store.subscribe(updates);
		reply(
			between,
			"chathistory #c",
			...[1, 2, 3].map(
				(s) => `time=2030-01-01T00:00:0${s}.000Z;msgid=m${s} :bob!u@h PRIVMSG #c :msg ${s}`,
			),
		);
		await flush();
		unsubscribe();

		expect(buf(app, "#c")!.messages.map((m) => m.params[1])).toEqual(["msg 1", "msg 2", "msg 3"]);
		expect(updates).toHaveBeenCalledTimes(1);
		expect(sent()).toEqual(["MARKREAD #c timestamp=2030-01-01T00:00:03.000Z"]);
	});

	it("marks the backlog of other buffers unread", async () => {
		const { app, recv, sent, reply, replyTargets } = await withBacklog();
		recv(":me!u@h JOIN #c");
		const between = await replyTargets();
		reply(
			between,
			"chathistory #c",
			"time=2030-01-01T00:00:01.000Z :bob!u@h PRIVMSG #c :hi",
			"time=2030-01-01T00:00:02.000Z :bob!u@h PRIVMSG #c :hi me",
		);
		await flush();
		expect(buf(app, "#c")!.messages).toHaveLength(2);
		expect(buf(app, "#c")!.unread).toBe(Unread.HIGHLIGHT);
		expect(sent().filter((l) => l.startsWith("MARKREAD"))).toEqual([]);
	});

	/** A page of n chat messages, one per second from 00:01:00 */
	const page = (n: number) =>
		Array.from({ length: n }, (_, i) => {
			const t = new Date(Date.UTC(2030, 0, 1, 0, 1, i)).toISOString();
			return `time=${t};msgid=p${i} :bob!u@h PRIVMSG #c :page ${i}`;
		});

	it("fetches older missed messages on demand", async () => {
		vi.spyOn(document, "hasFocus").mockReturnValue(true);
		const { app, recv, sent, sentRaw, reply, replyTargets } = await withBacklog();
		recv(":me!u@h JOIN #c", "@time=2030-01-01T00:00:00.500Z;msgid=old :bob!u@h PRIVMSG #c :old");
		app.setBufferState({ name: "#c" }, { hasInitialWho: true });
		app.switchBuffer(buf(app, "#c")!.id);
		sent();

		const between = await replyTargets();
		expect(between).toMatch(/BETWEEN #c timestamp=\S+ timestamp=2030-01-01T00:00:00.500Z 100$/);
		reply(between, "chathistory #c", ...page(100));
		await flush();

		expect(buf(app, "#c")!.messages).toHaveLength(101);
		expect(buf(app, "#c")!.gap).toEqual({
			after: { time: "2030-01-01T00:00:00.500Z", msgid: "old" },
			before: { time: "2030-01-01T00:01:00.000Z", msgid: "p0" },
			status: "idle",
		});
		// The missed messages before the page weren't read
		expect(sent().filter((l) => l.startsWith("MARKREAD"))).toEqual([]);

		const loading = app.fetchMissedMessages(buf(app, "#c")!.id);
		await flush();
		expect(buf(app, "#c")!.gap!.status).toBe("loading");
		const req = sentRaw().find((l) => l.includes("CHATHISTORY BETWEEN"))!;
		expect(req).toMatch(
			/BETWEEN #c timestamp=2030-01-01T00:00:00.500Z timestamp=2030-01-01T00:01:00.000Z 100$/,
		);
		reply(
			req,
			"chathistory #c",
			"time=2030-01-01T00:00:10.000Z;msgid=g1 :bob!u@h PRIVMSG #c :gap 1",
			"time=2030-01-01T00:00:20.000Z;msgid=g2 :bob!u@h PRIVMSG #c :gap 2",
		);
		await loading;

		const texts = buf(app, "#c")!.messages.map((m) => m.params[1]);
		expect(texts.slice(0, 4)).toEqual(["old", "gap 1", "gap 2", "page 0"]);
		expect(texts).toHaveLength(103);
		expect(buf(app, "#c")!.gap).toBeNull();
		expect(sent()).toEqual(["MARKREAD #c timestamp=2030-01-01T00:02:39.000Z"]);
	});

	it("keeps a gap to retry when loading missed messages fails", async () => {
		const { app, recv, sentRaw, reply, replyTargets } = await withBacklog();
		recv(":me!u@h JOIN #c", "@time=2030-01-01T00:00:00.500Z;msgid=old :bob!u@h PRIVMSG #c :old");
		reply(await replyTargets(), "chathistory #c", ...page(100));
		await flush();

		const loading = app.fetchMissedMessages(buf(app, "#c")!.id);
		await flush();
		const req = sentRaw().find((l) => l.includes("CHATHISTORY BETWEEN"))!;
		const label = req.match(/label=(\d+)/)![1];
		recv(`@label=${label} FAIL CHATHISTORY MESSAGE_ERROR #c :Messages could not be retrieved`);
		await expect(loading).rejects.toThrow();
		expect(buf(app, "#c")!.gap!.status).toBe("error");
	});

	it("doesn't mark a gap without loaded messages", async () => {
		const { app, recv, reply, replyTargets } = await withBacklog();
		recv(":me!u@h JOIN #c");
		reply(await replyTargets(), "chathistory #c", ...page(100));
		await flush();
		expect(buf(app, "#c")!.messages).toHaveLength(100);
		expect(buf(app, "#c")!.gap).toBeNull();
		expect(buf(app, "#c")!.unread).toBe(Unread.MESSAGE);
	});

	it("loads 200 missed messages by default, in pages of the server's limit", async () => {
		const { app, recv, sentRaw, reply, replyTargets } = await withBacklog({
			backlogSize: null,
		});
		expect(app.state.settings.backlogSize).toBe(200);
		recv(":me!u@h JOIN #c", "@time=2030-01-01T00:00:00.500Z;msgid=old :bob!u@h PRIVMSG #c :old");
		const first = await replyTargets();
		expect(first).toMatch(/BETWEEN #c timestamp=\S+ timestamp=2030-01-01T00:00:00.500Z 100$/);
		// The newest page, then the one before it
		const newer = Array.from({ length: 100 }, (_, i) => {
			const t = new Date(Date.UTC(2030, 0, 1, 0, 5, i)).toISOString();
			return `time=${t};msgid=n${i} :bob!u@h PRIVMSG #c :newer ${i}`;
		});
		reply(first, "chathistory #c", ...newer);
		await flush();
		const second = sentRaw().find((l) => l.includes("CHATHISTORY BETWEEN"))!;
		expect(second).toMatch(
			/BETWEEN #c msgid=n0 timestamp=2030-01-01T00:00:00.500Z 100$|BETWEEN #c timestamp=2030-01-01T00:05:00.000Z timestamp=2030-01-01T00:00:00.500Z 100$/,
		);
		reply(second, "chathistory #c", ...page(100));
		await flush();

		const texts = buf(app, "#c")!.messages.map((m) => m.params[1]);
		expect(texts).toHaveLength(201);
		expect(texts.slice(0, 3)).toEqual(["old", "page 0", "page 1"]);
		expect(texts[101]).toBe("newer 0");
		expect(buf(app, "#c")!.gap!.before).toEqual({ time: "2030-01-01T00:01:00.000Z", msgid: "p0" });
	});

	it("asks for the backlogSize setting when the server allows it", async () => {
		const { app, replyTargets } = await withBacklog({ backlogSize: 250, chathistory: 1000 });
		expect(await replyTargets()).toMatch(/BETWEEN #c timestamp=\S+ timestamp=\S+ 250$/);
		app.handleSettingsChange({ backlogSize: 150 });
		expect(app.state.settings.backlogSize).toBe(150);
	});

	it("doesn't report a backlog interrupted by a disconnection", async () => {
		const { app, ws, replyTargets } = await withBacklog();
		await replyTargets();
		vi.spyOn(console, "error").mockImplementation(() => {});
		ws.serverClose(1006);
		await flush();
		// The disconnection is reported, not the backlog request it failed
		expect(app.state.error).toBe("Connection error (abnormal closure)");
		app.destroy();
	});

	it("keeps a gap to load once reconnected when loading is interrupted", async () => {
		const { app, ws, recv, sentRaw, reply, replyTargets } = await withBacklog();
		recv(":me!u@h JOIN #c", "@time=2030-01-01T00:00:00.500Z;msgid=old :bob!u@h PRIVMSG #c :old");
		reply(await replyTargets(), "chathistory #c", ...page(100));
		await flush();

		const loading = app.fetchMissedMessages(buf(app, "#c")!.id);
		await flush();
		expect(sentRaw().some((l) => l.includes("CHATHISTORY BETWEEN"))).toBe(true);
		vi.spyOn(console, "error").mockImplementation(() => {});
		ws.serverClose(1006);
		await loading;
		expect(buf(app, "#c")!.gap!.status).toBe("idle");
		app.destroy();
	});

	it("drops the backlog of a server closed meanwhile", async () => {
		const { app, serverID, replyTargets } = await withBacklog();
		await replyTargets();
		vi.spyOn(console, "error").mockImplementation(() => {});
		app.close({ server: serverID, name: SERVER_BUFFER });
		await flush();
		expect(app.state.error).toBeNull();
		expect(app.state.buffers.size).toBe(0);
	});
});
