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
		await p;
		expect(buf(app, "#c")!.messages.map((m) => m.params[1])).toEqual(["old", "new"]);
		// No more history: further scrolls are no-ops
		await app.fetchOlderMessages();
		expect(sent()).toEqual([]);
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

	it("persists settings", async () => {
		const app = new AppController();
		app.handleSettingsChange({ secondsInTimestamps: false });
		expect(app.state.settings.secondsInTimestamps).toBe(false);
		expect(new AppController().state.settings.secondsInTimestamps).toBe(false);
	});
});
