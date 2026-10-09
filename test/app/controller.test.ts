import { describe, expect, it, vi } from "vitest";
import { connectedApp, flush } from "../helpers/app";
import { getBuffer, SERVER_BUFFER, Unread, BufferType } from "../../src/state";
import * as store from "../../src/store";
import AppController from "../../src/app/controller";
import { FakeWebSocket, installFakeWebSocket } from "../helpers/fake-ws";

function buf(app: AppController, name: string) {
	return getBuffer(app.state, { name });
}

describe("AppController configuration", () => {
	it("fills connect params from config and URL", async () => {
		window.history.replaceState(null, "", "/?nick=guest-*&channels=%23a,%23b&debug=1");
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
		expect(app.bufferStore.get({ name: "bob", server: {} })?.closed).toBe(true);
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

	it("tab-completes commands, channels and members", async () => {
		const { app, recv } = await connectedApp();
		recv(":me!u@h JOIN #chan", ":bob!u@h JOIN #chan", ":bobby!u@h JOIN #chan");
		app.switchBuffer(buf(app, "#chan")!.id);
		expect(app.autocomplete("/jo")).toEqual(["/join"]);
		expect(app.autocomplete("#ch")).toEqual(["#chan"]);
		expect(app.autocomplete("bo")).toEqual(["bob", "bobby"]);
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

	it("keeps renamed channels and their stored state", async () => {
		const { app, recv } = await connectedApp();
		recv(":me!u@h JOIN #old");
		app.switchBuffer(buf(app, "#old")!.id);
		recv(":srv RENAME #old #new :merge");
		expect(buf(app, "#old")).toBeUndefined();
		expect(buf(app, "#new")!.messages.at(-1)!.command).toBe("RENAME");
		expect(window.location.hash).toBe("#/#new");
		expect(app.bufferStore.get({ name: "#new", server: {} })).toBeDefined();
		expect(app.bufferStore.get({ name: "#old", server: {} })).toBeUndefined();
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

	it("sends throttled typing notifications", async () => {
		vi.useFakeTimers();
		const { app, sentRaw } = await chat();
		app.notifyTyping("h");
		app.notifyTyping("he");
		expect(sentRaw()).toEqual(["@+typing=active TAGMSG #c"]);
		vi.advanceTimersByTime(3000);
		app.notifyTyping("hel");
		expect(sentRaw()).toEqual(["@+typing=active TAGMSG #c"]);
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

describe("AppController notifications", () => {
	function stubNotifications() {
		const shown: string[] = [];
		class FakeNotification extends EventTarget {
			static permission = "granted";
			constructor(title: string) {
				super();
				shown.push(title);
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
});
