import { describe, expect, it, vi } from "vitest";
import { connectedApp, flush } from "./helpers/app";
import commands from "../src/commands";
import { getBuffer } from "../src/state";

async function inChannel() {
	const h = await connectedApp();
	h.recv(":me!u@h JOIN #c");
	h.app.setBufferState({ name: "#c" }, { hasInitialWho: true });
	h.app.switchBuffer(getBuffer(h.app.state, { name: "#c" })!.id);
	h.sent();
	return h;
}

describe("commands", () => {
	it("has help for every command", () => {
		for (const cmd of commands.values()) {
			expect(cmd.description).toBeTruthy();
		}
	});

	it.each([
		["/me waves", "PRIVMSG #c :\x01ACTION waves\x01"],
		["/topic new topic", "TOPIC #c :new topic"],
		["/topic", "TOPIC #c"],
		["/part", "PART #c"],
		["/part see you", "PART #c :see you"],
		["/kick bob go away", "KICK #c bob :go away"],
		["/op bob", "MODE #c +o bob"],
		["/deop bob", "MODE #c -o bob"],
		["/voice bob", "MODE #c +v bob"],
		["/devoice bob", "MODE #c -v bob"],
		["/invite bob", "INVITE bob #c"],
		["/mode +m", "MODE #c +m"],
		["/mode me +i", "MODE me +i"],
		["/ban", "MODE #c +b"],
		["/quiet", "MODE #c +q"],
		["/msg bob hi there", "PRIVMSG bob :hi there"],
		["/notice bob hi", "NOTICE bob hi"],
		["/nick newme", "NICK newme"],
		["/away gone fishing", "AWAY :gone fishing"],
		["/away", "AWAY"],
		["/quote PRIVMSG #x :raw text", "PRIVMSG #x :raw text"],
		["/whois bob", "WHOIS bob"],
		["/who #c", "WHO #c"],
		["/whowas bob 3", "WHOWAS bob 3"],
		["/list #foo*", "LIST #foo*"],
		["/motd", "MOTD"],
		["/lusers", "LUSERS"],
		["/stats u", "STATS u"],
	])("%s sends %s", async (input, expected) => {
		const { app, sent } = await inChannel();
		app.handleComposerSubmit(input);
		expect(sent()).toContain(expected);
	});

	it.each([
		["/join  #spaced", "JOIN #spaced"],
		["/join foo", "JOIN #foo"],
		["/JOIN #upper", "JOIN #upper"],
	])("parses %s as %s", async (input, expected) => {
		const { app, sent } = await inChannel();
		app.handleComposerSubmit(input);
		expect(sent()).toContain(expected);
	});

	it("rejects /msg and /notice without a message", async () => {
		const { app, sent } = await inChannel();
		vi.spyOn(console, "error").mockImplementation(() => {});
		app.handleComposerSubmit("/msg bob");
		expect(app.state.error).toBe("Missing message");
		app.handleComposerSubmit("/notice bob");
		expect(sent()).toEqual([]);
	});

	it("shows /msg locally without echo-message", async () => {
		const { app, recv, sent } = await connectedApp({
			caps: "batch server-time message-tags labeled-response draft/chathistory",
		});
		recv(":bob!u@h PRIVMSG me :hey");
		sent();
		app.handleComposerSubmit("/msg bob hi there");
		expect(sent()).toContain("PRIVMSG bob :hi there");
		const bob = getBuffer(app.state, { name: "bob" })!;
		expect(bob.messages.at(-1)!.params).toEqual(["bob", "hi there"]);
	});

	it("bans before kicking with /kickban", async () => {
		const { app, sent, recv } = await inChannel();
		app.handleComposerSubmit("/kickban bob");
		expect(sent()).toEqual(["WHOIS bob"]);
		recv(":srv 311 me bob buser bhost * :Bob", ":srv 318 me bob :End");
		await flush();
		expect(sent()).toEqual(["MODE #c +b *!buser@bhost", "KICK #c bob"]);
	});

	it("collapses repeated and trailing spaces", async () => {
		const { app, sent } = await inChannel();
		app.handleComposerSubmit("/msg bob  hi there ");
		app.handleComposerSubmit("/whowas bob ");
		expect(sent()).toEqual(["PRIVMSG bob :hi there", "WHOWAS bob"]);
	});

	it("can't join channels on a connection without channels", async () => {
		const { app, sent } = await connectedApp({ isupport: "CASEMAPPING=ascii CHANTYPES= BOT=B" });
		vi.spyOn(console, "error").mockImplementation(() => {});
		app.handleComposerSubmit("/join #foo");
		expect(app.state.error).toMatch(/switch to a network/);
		expect(sent()).toEqual([]);
	});

	it("requires a nick for /kickban before banning", async () => {
		const { app, sent } = await inChannel();
		vi.spyOn(console, "error").mockImplementation(() => {});
		app.handleComposerSubmit("/kickban");
		await flush();
		expect(app.state.error).toBe("Missing nick");
		expect(sent()).toEqual([]);
	});

	it("shows /notice in the server buffer without echo-message", async () => {
		const { app, sent } = await connectedApp({
			caps: "batch server-time message-tags labeled-response draft/chathistory",
		});
		app.handleComposerSubmit("/notice bob hi");
		expect(sent()).toContain("NOTICE bob hi");
		expect(getBuffer(app.state, { name: "bob" })).toBeUndefined();
		expect(getBuffer(app.state, { name: "*" })!.messages.at(-1)!.params).toEqual(["bob", "hi"]);
	});

	it("bans by host after a WHOIS", async () => {
		const { app, sent, recv } = await inChannel();
		app.handleComposerSubmit("/ban bob");
		expect(sent()).toEqual(["WHOIS bob"]);
		recv(":srv 311 me bob buser bhost * :Bob", ":srv 318 me bob :End");
		await flush();
		expect(sent()).toEqual(["MODE #c +b *!buser@bhost"]);
	});

	it("reports usage errors", async () => {
		const { app } = await inChannel();
		vi.spyOn(console, "error").mockImplementation(() => {});
		app.handleComposerSubmit("/join");
		expect(app.state.error).toBe("Missing channel name");
		app.handleComposerSubmit("/quote @bad");
		expect(app.state.error).toBe("Failed to parse IRC command");
		app.handleComposerSubmit("/setname x");
		expect(app.state.error).toBe("Server doesn't support changing the realname");
	});

	it("requires a channel for channel commands", async () => {
		const { app } = await connectedApp();
		vi.spyOn(console, "error").mockImplementation(() => {});
		app.handleComposerSubmit("/topic x");
		expect(app.state.error).toBe("Not in a channel");
	});

	it("opens queries and joins channels", async () => {
		const { app, sent } = await inChannel();
		app.handleComposerSubmit("/query bob hello");
		expect(getBuffer(app.state, { name: "bob" })).toBeDefined();
		expect(sent()).toContain("PRIVMSG bob hello");
		app.handleComposerSubmit("/j #new key");
		expect(sent()).toContain("JOIN #new key");
	});

	it("switches and closes buffers", async () => {
		const { app } = await inChannel();
		app.handleComposerSubmit("/buffer *");
		expect(getBuffer(app.state, app.state.activeBuffer)!.name).toBe("*");
		app.handleComposerSubmit("/buffer #c");
		app.handleComposerSubmit("/close");
		expect(getBuffer(app.state, { name: "#c" })).toBeUndefined();
		app.handleComposerSubmit("/help");
		expect(app.state.dialog).toEqual({ kind: "help" });
	});
});
