import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import * as irc from "../../src/lib/irc";
import SwitcherForm from "../../src/components/forms/SwitcherForm";
import ConnectForm from "../../src/components/forms/ConnectForm";
import NetworkForm from "../../src/components/forms/NetworkForm";
import SettingsForm from "../../src/components/forms/SettingsForm";
import JoinForm from "../../src/components/forms/JoinForm";
import Help from "../../src/components/forms/Help";
import { defaultConnectParams } from "../../src/app/store";
import { BufferType, defaultSettings, type Buffer, type Server } from "../../src/state";

describe("SwitcherForm", () => {
	const server = {
		id: 1,
		name: "Net",
		isBouncer: false,
		bouncerNetID: null,
		users: new irc.CaseMapMap(null, irc.CaseMapping.RFC1459),
	} as unknown as Server;
	const mk = (id: number, name: string, type: Buffer["type"]) =>
		[id, { id, name, type, server: 1, topic: null } as Buffer] as const;
	const buffers = new Map([
		mk(1, "*", BufferType.SERVER),
		mk(2, "#alpha", BufferType.CHANNEL),
		mk(3, "#beta", BufferType.CHANNEL),
		mk(4, "bob", BufferType.NICK),
	]);

	it("filters and selects with the keyboard", async () => {
		const onSubmit = vi.fn();
		render(
			<SwitcherForm
				buffers={buffers}
				servers={new Map([[1, server]])}
				bouncerNetworks={new Map()}
				onSubmit={onSubmit}
			/>,
		);
		expect(screen.getAllByRole("option")).toHaveLength(3);
		await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}");
		expect(screen.getByRole("option", { selected: true })).toHaveTextContent("bob");
		await userEvent.type(screen.getByRole("combobox"), "be");
		expect(screen.getAllByRole("option")).toHaveLength(1);
		await userEvent.keyboard("{Enter}");
		expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "#beta" }));
	});

	it("scrolls the selected option into view", async () => {
		// Not implemented by jsdom
		const scrolled: string[] = [];
		HTMLElement.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
			expect(options).toEqual({ block: "nearest" });
			scrolled.push(this.textContent ?? "");
		};
		onTestFinished(() => {
			delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
		});
		render(
			<SwitcherForm
				buffers={buffers}
				servers={new Map([[1, server]])}
				bouncerNetworks={new Map()}
				onSubmit={vi.fn()}
			/>,
		);
		scrolled.length = 0;
		await userEvent.keyboard("{ArrowDown}{ArrowDown}");
		expect(scrolled).toEqual([expect.stringContaining("#beta"), expect.stringContaining("bob")]);
	});

	it("submits on click and handles no results", async () => {
		const onSubmit = vi.fn();
		render(
			<SwitcherForm
				buffers={buffers}
				servers={new Map([[1, server]])}
				bouncerNetworks={new Map()}
				onSubmit={onSubmit}
			/>,
		);
		await userEvent.click(screen.getByRole("option", { name: /#alpha/ }));
		expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "#alpha" }));
		await userEvent.type(screen.getByRole("combobox"), "zzz");
		expect(screen.getByText("No matching buffers")).toBeInTheDocument();
	});
});

describe("ConnectForm", () => {
	it("submits connection parameters with SASL", async () => {
		const onSubmit = vi.fn();
		render(
			<ConnectForm
				params={{ ...defaultConnectParams, autojoin: ["#a", "#b"] }}
				connecting={false}
				error={null}
				onSubmit={onSubmit}
			/>,
		);
		await userEvent.type(screen.getByLabelText("Nickname"), "alice");
		await userEvent.type(screen.getByLabelText("Password"), "pw");
		await userEvent.click(screen.getByText("Remember me"));
		expect(screen.getByText("#a, #b")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Connect" }));
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				nick: "alice",
				autoconnect: true,
				saslPlain: { username: "alice", password: "pw" },
				autojoin: ["#a", "#b"],
			}),
		);
	});

	it("shows the server URL only when not configured, and errors", () => {
		const { rerender } = render(
			<ConnectForm
				params={defaultConnectParams}
				connecting={false}
				error="Boom https://x.org"
				onSubmit={() => {}}
			/>,
		);
		expect(screen.getByLabelText("Server URL", { selector: "input" })).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent("Boom");
		expect(screen.getByRole("link", { name: "https://x.org" })).toBeInTheDocument();
		rerender(
			<ConnectForm
				params={{ ...defaultConnectParams, url: "wss://x" }}
				connecting
				onSubmit={() => {}}
				error={null}
			/>,
		);
		expect(screen.queryByLabelText("Server URL")).toBeNull();
		expect(screen.getByRole("button", { name: /Connecting/ })).toBeDisabled();
	});

	it("shows the server and toggles password visibility", async () => {
		render(
			<ConnectForm
				params={{ ...defaultConnectParams, url: "wss://irc.example.org/socket" }}
				connecting={false}
				error={null}
				onSubmit={() => {}}
			/>,
		);
		expect(screen.getByText("irc.example.org")).toBeInTheDocument();
		const password = screen.getByLabelText("Password");
		expect(password).toHaveAttribute("type", "password");
		await userEvent.click(screen.getByRole("button", { name: "Show password" }));
		expect(password).toHaveAttribute("type", "text");
		await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
		expect(password).toHaveAttribute("type", "password");
	});

	it("hides the password with external auth", () => {
		render(
			<ConnectForm
				params={defaultConnectParams}
				auth="external"
				connecting={false}
				error={null}
				onSubmit={() => {}}
			/>,
		);
		expect(screen.queryByLabelText("Password")).toBeNull();
	});
});

describe("NetworkForm", () => {
	it("only submits changed attributes", async () => {
		const onSubmit = vi.fn(async () => {});
		render(
			<NetworkForm
				isNew={false}
				params={{ host: "irc.a", name: "A", port: "6697" }}
				onSubmit={onSubmit}
				onRemove={async () => {}}
			/>,
		);
		const host = screen.getByLabelText("Hostname");
		await userEvent.clear(host);
		await userEvent.type(host, "irc.b");
		await userEvent.click(screen.getByRole("button", { name: "Save network" }));
		expect(onSubmit).toHaveBeenCalledWith({ host: "irc.b" }, null);
	});

	it("adds networks with auto-join", async () => {
		const onSubmit = vi.fn(async () => {});
		render(<NetworkForm isNew autojoin="#chan" onSubmit={onSubmit} onRemove={async () => {}} />);
		await userEvent.type(screen.getByLabelText("Hostname"), "irc.new");
		await userEvent.click(screen.getByRole("button", { name: "Add network" }));
		expect(onSubmit).toHaveBeenCalledWith({ host: "irc.new" }, "#chan");
		expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
	});

	it("sends the port shown when TLS is turned off", async () => {
		const onSubmit = vi.fn(async () => {});
		render(<NetworkForm isNew onSubmit={onSubmit} onRemove={async () => {}} />);
		await userEvent.type(screen.getByLabelText("Hostname"), "irc.new");
		await userEvent.click(screen.getByRole("checkbox", { name: /Use TLS/ }));
		await userEvent.click(screen.getByRole("button", { name: "Add network" }));
		expect(onSubmit).toHaveBeenCalledWith({ host: "irc.new", port: "6697", tls: "0" }, null);
	});

	it("doesn't submit again while the bouncer handles the change", async () => {
		let done = () => {};
		const onSubmit = vi.fn(() => new Promise<void>((resolve) => (done = resolve)));
		render(<NetworkForm isNew onSubmit={onSubmit} onRemove={async () => {}} />);
		await userEvent.type(screen.getByLabelText("Hostname"), "irc.new{Enter}");
		const submit = screen.getByRole("button", { name: "Add network" });
		expect(submit).toBeDisabled();
		await userEvent.type(screen.getByLabelText("Hostname"), "{Enter}");
		expect(onSubmit).toHaveBeenCalledTimes(1);
		await act(async () => done());
		expect(submit).toBeEnabled();
	});
});

describe("SettingsForm", () => {
	it("reports changes", async () => {
		const onChange = vi.fn();
		const onDisconnect = vi.fn();
		render(
			<SettingsForm
				settings={defaultSettings}
				showProtocolHandler={false}
				onChange={onChange}
				onDisconnect={onDisconnect}
				onClose={() => {}}
			/>,
		);
		await userEvent.click(screen.getByRole("tab", { name: "Messages" }));
		await userEvent.click(screen.getByLabelText("Show seconds in time indicator"));
		expect(onChange).toHaveBeenCalledWith({ secondsInTimestamps: false });
		await userEvent.click(screen.getByRole("radio", { name: "Hide" }));
		expect(onChange).toHaveBeenCalledWith({ bufferEvents: "hide" });
		await userEvent.click(screen.getByRole("tab", { name: "Notifications" }));
		await userEvent.click(screen.getByRole("radio", { name: "All" }));
		expect(onChange).toHaveBeenCalledWith({ notifications: "all" });
		await userEvent.click(screen.getByRole("radio", { name: "5 min" }));
		expect(onChange).toHaveBeenCalledWith({ autoAwayMinutes: 5 });
		await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
		expect(onDisconnect).toHaveBeenCalled();
	});
});

describe("SettingsForm missed messages to load", () => {
	it("reports integers within bounds only", async () => {
		const onChange = vi.fn();
		render(
			<SettingsForm
				settings={defaultSettings}
				showProtocolHandler={false}
				onChange={onChange}
				onDisconnect={() => {}}
				onClose={() => {}}
			/>,
		);
		await userEvent.click(screen.getByRole("tab", { name: "Messages" }));
		const input = screen.getByLabelText("Missed messages to load on connect");
		expect(input).toHaveValue(200);

		await userEvent.clear(input);
		await userEvent.type(input, "500");
		expect(onChange).toHaveBeenLastCalledWith({ backlogSize: 500 });

		onChange.mockClear();
		for (const invalid of ["0", "99", "4001", "1.5"]) {
			await userEvent.clear(input);
			await userEvent.type(input, invalid);
		}
		expect(onChange.mock.calls.map((c) => c[0].backlogSize)).not.toContain(0);
		expect(onChange.mock.calls.map((c) => c[0].backlogSize)).not.toContain(99);
		expect(onChange.mock.calls.map((c) => c[0].backlogSize)).not.toContain(4001);
		expect(onChange.mock.calls.map((c) => c[0].backlogSize)).not.toContain(1.5);
		// An invalid input goes back to the current value
		await userEvent.tab();
		expect(input).toHaveValue(200);
	});
});

describe("SettingsForm theme and layout", () => {
	it("picks a theme and a layout", async () => {
		const onChange = vi.fn();
		render(
			<SettingsForm
				settings={defaultSettings}
				showProtocolHandler={false}
				onChange={onChange}
				onDisconnect={() => {}}
				onClose={() => {}}
			/>,
		);
		expect(screen.getByRole("radio", { name: "Dracula" })).toBeChecked();
		await userEvent.click(screen.getByRole("radio", { name: "Catppuccin Mocha" }));
		expect(onChange).toHaveBeenCalledWith({ theme: "catppuccin-mocha" });
		expect(screen.getByRole("radio", { name: /Compact/ })).toBeChecked();
		await userEvent.click(screen.getByRole("radio", { name: /Comfortable/ }));
		expect(onChange).toHaveBeenCalledWith({ layout: "comfortable" });
	});

	it("shows the columns layout options only for that layout", async () => {
		const onChange = vi.fn();
		const props = {
			showProtocolHandler: false,
			onChange,
			onDisconnect: () => {},
			onClose: () => {},
		};
		const { rerender } = render(<SettingsForm settings={defaultSettings} {...props} />);
		expect(screen.queryByText("Nick alignment")).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("checkbox", { name: "Nick colors" }));
		expect(onChange).toHaveBeenCalledWith({ nickColors: false });

		rerender(<SettingsForm settings={{ ...defaultSettings, layout: "columns" }} {...props} />);
		await userEvent.click(screen.getByRole("radio", { name: "Left" }));
		expect(onChange).toHaveBeenCalledWith({ nickAlign: "left" });
		await userEvent.click(screen.getByRole("radio", { name: "16" }));
		expect(onChange).toHaveBeenCalledWith({ nickColumnWidth: 16 });
		await userEvent.click(screen.getByRole("checkbox", { name: "Hide repeated nicks" }));
		expect(onChange).toHaveBeenCalledWith({ hideRepeatedNicks: true });
		await userEvent.click(screen.getByRole("checkbox", { name: "Brackets around nicks" }));
		expect(onChange).toHaveBeenCalledWith({ nickBrackets: true });
	});
});

describe("SettingsForm push notifications", () => {
	it("toggles push and shows errors", async () => {
		const onPushChange = vi
			.fn()
			.mockRejectedValueOnce(new Error("Notification permission denied"))
			.mockResolvedValue(undefined);
		render(
			<SettingsForm
				settings={defaultSettings}
				showProtocolHandler={false}
				pushAvailable
				onPushChange={onPushChange}
				onChange={() => {}}
				onDisconnect={() => {}}
				onClose={() => {}}
			/>,
		);
		await userEvent.click(screen.getByRole("tab", { name: "Notifications" }));
		const toggle = screen.getByRole("checkbox", { name: /Push notifications/ });
		await userEvent.click(toggle);
		expect(onPushChange).toHaveBeenCalledWith(true);
		expect(await screen.findByRole("alert")).toHaveTextContent("Notification permission denied");
		await userEvent.click(toggle);
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("hides the toggle when unavailable", async () => {
		render(
			<SettingsForm
				settings={defaultSettings}
				showProtocolHandler={false}
				onChange={() => {}}
				onDisconnect={() => {}}
				onClose={() => {}}
			/>,
		);
		await userEvent.click(screen.getByRole("tab", { name: "Notifications" }));
		expect(screen.queryByRole("checkbox", { name: /Push notifications/ })).toBeNull();
	});
});

describe("JoinForm and Help", () => {
	it("submits the channel", async () => {
		const onSubmit = vi.fn();
		render(<JoinForm onSubmit={onSubmit} />);
		await userEvent.type(screen.getByLabelText("Channel"), "test{Enter}");
		expect(onSubmit).toHaveBeenCalledWith("#test");
	});

	it("lists commands and key bindings", () => {
		render(<Help />);
		expect(screen.getByText("/join")).toBeInTheDocument();
		expect(screen.getAllByText("Switch to a buffer").length).toBeGreaterThan(0);
		expect(screen.getByText("Mark all messages as read")).toBeInTheDocument();
	});
});
