import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../../src/components/App";
import AppController from "../../src/app/controller";
import { FakeWebSocket, installFakeWebSocket } from "../helpers/fake-ws";

async function renderApp() {
	installFakeWebSocket();
	const app = new AppController();
	render(<App controller={app} />);
	await act(() => app.handleConfig({ server: { url: "wss://irc.test" } }));
	return app;
}

function serverSays(ws: FakeWebSocket, ...lines: string[]) {
	act(() => ws.receive(...lines));
}

async function login(app: AppController, bouncer = false) {
	await userEvent.type(screen.getByLabelText("Nickname"), "me");
	await userEvent.click(screen.getByRole("button", { name: "Connect" }));
	const ws = FakeWebSocket.last();
	act(() => ws.open());
	const caps = "batch server-time echo-message" + (bouncer ? " soju.im/bouncer-networks" : "");
	serverSays(
		ws,
		`:srv CAP * LS :${caps}`,
		`:srv CAP me ACK :${caps}`,
		":srv 001 me :Welcome",
		":srv 005 me CHANTYPES=# NETWORK=TestNet PREFIX=(ov)@+ :ok",
		":srv 376 me :End",
	);
	ws.sent = [];
	return ws;
}

describe("App", () => {
	it("shows a spinner while loading the config", () => {
		const app = new AppController();
		render(<App controller={app} />);
		expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
	});

	it("connects and chats", async () => {
		const app = await renderApp();
		expect(screen.getByRole("heading", { name: "Connect to IRC" })).toBeInTheDocument();
		const ws = await login(app);
		expect(ws.url).toBe("wss://irc.test");

		const tabs = screen.getByRole("tablist", { name: "Buffer list" });
		expect(within(tabs).getByRole("tab", { name: "TestNet" })).toHaveAttribute("aria-selected", "true");

		serverSays(
			ws,
			":me!u@h JOIN #c",
			":srv 332 me #c :The topic",
			":srv 353 me = #c :@me bob",
			":srv 366 me #c :End",
		);
		await userEvent.click(within(tabs).getByRole("tab", { name: "#c" }));
		expect(screen.getByRole("heading", { level: 1, name: "#c" })).toBeInTheDocument();
		expect(screen.getByText("The topic")).toBeInTheDocument();

		await userEvent.type(screen.getByRole("textbox", { name: "Type a message" }), "hello{Enter}");
		expect(ws.sent.some((l) => l.endsWith("PRIVMSG #c hello"))).toBe(true);
		serverSays(ws, ":me!u@h PRIVMSG #c hello", ":bob!u@h PRIVMSG #c :hi me");
		const log = screen.getByRole("log");
		expect(within(log).getByText("hello")).toBeInTheDocument();
		expect(within(log).getByText("hi me").closest(".logline")).toHaveClass("highlight");
	});

	it("shows who is typing, unless turned off", async () => {
		const app = await renderApp();
		const ws = await login(app);
		serverSays(ws, ":me!u@h JOIN #c", ":srv 353 me = #c :@me bob", ":srv 366 me #c :End");
		const tabs = screen.getByRole("tablist", { name: "Buffer list" });
		await userEvent.click(within(tabs).getByRole("tab", { name: "#c" }));
		serverSays(ws, "@+typing=active :bob!u@h TAGMSG #c");
		expect(screen.getByText(/bob is typing/)).toBeInTheDocument();
		act(() => app.handleSettingsChange({ showTyping: false }));
		expect(screen.queryByText(/is typing/)).toBeNull();
	});

	it("opens dialogs from the header and keyboard", async () => {
		const app = await renderApp();
		await login(app);
		await userEvent.click(screen.getByRole("button", { name: "Join channel" }));
		const dialog = screen.getByRole("dialog", { name: "Join channel" });
		expect(within(dialog).getByLabelText("Channel")).toHaveFocus();
		await userEvent.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).toBeNull();

		await userEvent.click(screen.getByRole("button", { name: "Settings" }));
		expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
		await userEvent.click(screen.getByRole("tab", { name: "Messages" }));
		await userEvent.click(screen.getByLabelText("Show member list"));
		expect(app.state.settings.showMemberList).toBe(true);
		await userEvent.click(screen.getByRole("button", { name: "Done" }));

		await userEvent.keyboard("{Control>}k{/Control}");
		expect(screen.getByRole("dialog", { name: "Switch to a channel or user" })).toBeInTheDocument();
	});

	it("sets the away status with commands after removing the sidebar footer", async () => {
		const app = await renderApp();
		const ws = await login(app);
		expect(document.querySelector(".sidebar-footer")).toBeNull();
		const composer = screen.getByRole("textbox", { name: /Type a command/ });
		await userEvent.type(composer, "/away lunch{Enter}");
		expect(ws.sent).toEqual(["AWAY lunch"]);
		await userEvent.type(composer, "/away{Enter}");
		expect(ws.sent).toEqual(["AWAY lunch", "AWAY"]);
		expect(app.state.awayMessage).toBeNull();
	});

	it("acts on channel members from the member list", async () => {
		const app = await renderApp();
		const ws = await login(app);
		serverSays(ws, ":me!u@h JOIN #c", ":srv 353 me = #c :@me +bob carol", ":srv 366 me #c :End");
		await userEvent.click(screen.getByRole("tab", { name: "#c" }));
		ws.sent = [];
		const members = screen.getByRole("complementary", { name: "Members list" });

		await userEvent.click(within(members).getByRole("button", { name: "Actions for bob" }));
		expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
			"Send message",
			"Show info",
			"Make operator",
			"Remove voice",
			"Kick",
			"Ban",
			"Kick and ban",
		]);
		await userEvent.click(screen.getByRole("menuitem", { name: "Make operator" }));
		expect(ws.sent).toEqual(["MODE #c +o bob"]);

		const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
		await userEvent.pointer({ keys: "[MouseRight]", target: within(members).getByText("carol") });
		await userEvent.click(screen.getByRole("menuitem", { name: "Kick" }));
		expect(confirm).toHaveBeenCalledWith("Kick carol from #c?");
		expect(ws.sent).toEqual(["MODE #c +o bob"]);
		confirm.mockReturnValue(true);
		await userEvent.click(within(members).getByRole("button", { name: "Actions for carol" }));
		await userEvent.click(screen.getByRole("menuitem", { name: "Kick" }));
		expect(ws.sent).toEqual(["MODE #c +o bob", "KICK #c carol"]);
		confirm.mockRestore();

		await userEvent.click(within(members).getByRole("button", { name: "Actions for carol" }));
		await userEvent.click(screen.getByRole("menuitem", { name: "Send message" }));
		expect(screen.getByRole("heading", { level: 1, name: "carol" })).toBeInTheDocument();
	});

	it("only offers moderation to channel operators", async () => {
		const app = await renderApp();
		const ws = await login(app);
		serverSays(ws, ":me!u@h JOIN #c", ":srv 353 me = #c :me bob", ":srv 366 me #c :End");
		await userEvent.click(screen.getByRole("tab", { name: "#c" }));
		const members = screen.getByRole("complementary", { name: "Members list" });
		await userEvent.click(within(members).getByRole("button", { name: "Actions for bob" }));
		expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
			"Send message",
			"Show info",
		]);
	});

	it("shows the app version in Settings About without a bouncer section", async () => {
		vi.stubEnv("GAMJA_VERSION", "v1.2.3");
		try {
			const app = await renderApp();
			const ws = await login(app, true);
			serverSays(ws, ":srv 004 me bouncer.test soju-rs/0.99.31 aiwroO Oov");
			expect(screen.queryByTitle("gamja version")).toBeNull();
			await userEvent.click(screen.getByRole("button", { name: "Settings" }));
			await userEvent.click(screen.getByRole("tab", { name: "About" }));
			expect(screen.getByTitle("gamja version")).toHaveTextContent("v1.2.3");
			expect(screen.queryByRole("heading", { name: "Bouncer" })).not.toBeInTheDocument();
			expect(screen.queryByText("soju-rs/0.99.31")).not.toBeInTheDocument();
			expect(screen.getByRole("heading", { name: "Dependencies" })).toBeInTheDocument();
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("shows and dismisses errors", async () => {
		const app = await renderApp();
		await login(app);
		act(() => app.showError(new Error("outer", { cause: new Error("inner") })));
		expect(screen.getByRole("alert")).toHaveTextContent("outer: inner");
		await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("goes back to the connect form after disconnecting", async () => {
		const app = await renderApp();
		await login(app);
		await userEvent.click(screen.getByRole("button", { name: "Settings" }));
		await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
		expect(screen.getByRole("heading", { name: "Connect to IRC" })).toBeInTheDocument();
	});
});
