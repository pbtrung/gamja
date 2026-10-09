import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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

async function login(app: AppController) {
	await userEvent.type(screen.getByLabelText("Nickname"), "me");
	await userEvent.click(screen.getByRole("button", { name: "Connect" }));
	const ws = FakeWebSocket.last();
	act(() => ws.open());
	serverSays(
		ws,
		":srv CAP * LS :batch server-time echo-message",
		":srv CAP me ACK :batch server-time echo-message",
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
		await userEvent.click(screen.getByLabelText("Show member list"));
		expect(app.state.settings.showMemberList).toBe(true);
		await userEvent.click(screen.getByRole("button", { name: "Done" }));

		await userEvent.keyboard("{Control>}k{/Control}");
		expect(screen.getByRole("dialog", { name: "Switch to a channel or user" })).toBeInTheDocument();
	});

	it("sets the away status from the buffer list", async () => {
		const app = await renderApp();
		const ws = await login(app);
		await userEvent.click(screen.getByRole("button", { name: "me, Online. Change status" }));
		await userEvent.click(screen.getByRole("menuitem", { name: "Set away…" }));
		const dialog = screen.getByRole("dialog", { name: "Set away" });
		const input = within(dialog).getByLabelText("Message");
		await userEvent.clear(input);
		await userEvent.type(input, "lunch");
		await userEvent.click(within(dialog).getByRole("button", { name: "Set away" }));
		expect(ws.sent).toEqual(["AWAY lunch"]);

		await userEvent.click(screen.getByRole("button", { name: "me, Away: lunch. Change status" }));
		await userEvent.click(screen.getByRole("menuitem", { name: "Set as back" }));
		expect(ws.sent).toEqual(["AWAY lunch", "AWAY"]);
		expect(screen.getByRole("button", { name: "me, Online. Change status" })).toBeInTheDocument();
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
