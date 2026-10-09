import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as irc from "../../src/lib/irc";
import BufferHeader, { type BufferHeaderProps } from "../../src/components/BufferHeader";
import { BufferType, ServerStatus, Unread, type Buffer, type Server } from "../../src/state";

function setup(
	patch: { buffer?: Partial<Buffer>; server?: Partial<Server> } & Omit<
		Partial<BufferHeaderProps>,
		"buffer" | "server"
	> = {},
) {
	const { buffer: bufPatch, server: serverPatch, ...rest } = patch;
	const props: BufferHeaderProps = {
		buffer: {
			id: 1,
			name: "*",
			type: BufferType.SERVER,
			serverInfo: null,
			topic: null,
			joined: false,
			...bufPatch,
		} as Buffer,
		server: {
			name: "Net",
			status: ServerStatus.REGISTERED,
			isBouncer: false,
			bouncerNetID: null,
			reliableUserAccounts: false,
			users: new irc.CaseMapMap(null, irc.CaseMapping.RFC1459),
			...serverPatch,
		} as Server,
		user: null,
		bouncerNetwork: null,
		memberListHidden: false,
		unreadElsewhere: Unread.NONE,
		onChannelClick: vi.fn(),
		onClose: vi.fn(),
		onJoin: vi.fn(),
		onReconnect: vi.fn(),
		onAddNetwork: vi.fn(),
		onManageNetwork: vi.fn(),
		onOpenSettings: vi.fn(),
		onOpenBufferList: vi.fn(),
		onOpenMemberList: vi.fn(),
		...rest,
	};
	render(<BufferHeader {...props} />);
	return props;
}

const buttons = () => screen.getAllByRole("button").map((b) => b.getAttribute("title"));

describe("BufferHeader", () => {
	it("describes server connection states", () => {
		setup({ server: { status: ServerStatus.CONNECTING } });
		expect(screen.getByText("Connecting…")).toBeInTheDocument();
	});

	it("offers reconnecting when disconnected", async () => {
		const props = setup({ server: { status: ServerStatus.DISCONNECTED } });
		expect(screen.getByText("Disconnected")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Reconnect" }));
		expect(props.onReconnect).toHaveBeenCalled();
	});

	it("counts down to the next reconnection", () => {
		vi.useFakeTimers();
		try {
			setup({ server: { status: ServerStatus.DISCONNECTED, reconnectAt: Date.now() + 65 * 1000 } });
			expect(screen.getByText("Disconnected, reconnecting in 1m 5s")).toBeInTheDocument();
			act(() => vi.advanceTimersByTime(10 * 1000));
			expect(screen.getByText("Disconnected, reconnecting in 55s")).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
	});

	it("shows the lag", () => {
		setup({ buffer: { serverInfo: { name: "irc.example", version: "1" } }, server: { lag: 42 } });
		expect(screen.getByText("Connected to irc.example · 42 ms lag")).toBeInTheDocument();
	});

	it("shows server info and join/settings for plain servers", () => {
		setup({ buffer: { serverInfo: { name: "irc.example", version: "1" } } });
		expect(screen.getByText("Connected to irc.example")).toBeInTheDocument();
		expect(buttons()).toEqual(["Open buffer list", "Join channel", "Settings"]);
	});

	it("manages bouncer networks", async () => {
		const props = setup({ server: { isBouncer: true } });
		expect(buttons()).toEqual(["Open buffer list", "Add network", "Settings"]);
		await userEvent.click(screen.getByRole("button", { name: "Add network" }));
		expect(props.onAddNetwork).toHaveBeenCalled();
	});

	it("shows bouncer network state", () => {
		setup({
			server: { isBouncer: true, bouncerNetID: "1" },
			bouncerNetwork: { state: "disconnected", error: "connection refused", host: "irc.x" },
		});
		expect(screen.getByText("Bouncer disconnected from network: connection refused")).toBeInTheDocument();
		expect(buttons()).toEqual(["Open buffer list", "Manage network"]);
	});

	it("shows the topic and channel actions", async () => {
		const props = setup({
			buffer: {
				type: BufferType.CHANNEL,
				name: "#c",
				topic: "\x02Hello\x02 https://x.org",
				joined: true,
			},
			memberListHidden: true,
			onSearch: vi.fn(),
		});
		expect(screen.getByRole("heading", { name: "#c" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "https://x.org" })).toBeInTheDocument();
		expect(buttons()).toEqual(["Open buffer list", "Open member list", "Search", "Leave"]);
		await userEvent.click(screen.getByRole("button", { name: "Leave" }));
		expect(props.onClose).toHaveBeenCalled();
	});

	it("offers to rejoin parted channels", () => {
		setup({ buffer: { type: BufferType.CHANNEL, name: "#c", joined: false } });
		expect(buttons()).toContain("Join");
		expect(buttons()).toContain("Close");
	});

	it("describes users", () => {
		setup({
			buffer: { type: BufferType.NICK, name: "bob" },
			server: { reliableUserAccounts: true },
			user: {
				nick: "bob",
				realname: "Bob Smith",
				username: "b",
				hostname: "host",
				account: "bobby",
				operator: true,
				bot: true,
				away: true,
			},
		});
		expect(screen.getByRole("img", { name: "User is away" })).toBeInTheDocument();
		expect(screen.getByText(/Bob Smith/)).toHaveTextContent(
			"Bob Smith (b@host, authenticated as bobby, server operator, bot)",
		);
	});

	it("flags unauthenticated and offline users", () => {
		setup({
			buffer: { type: BufferType.NICK, name: "bob" },
			server: { reliableUserAccounts: true },
			user: { nick: "bob", offline: true },
		});
		expect(screen.getByRole("img", { name: "User is offline" })).toBeInTheDocument();
		expect(screen.getByText("unauthenticated")).toBeInTheDocument();
	});

	it("shows unread activity on the buffer list toggle", () => {
		setup({ unreadElsewhere: Unread.HIGHLIGHT });
		expect(document.querySelector(".buffer-list-toggle .unread-highlight")).toBeInTheDocument();
	});

	it("puts actions in a menu on small screens", async () => {
		vi.stubGlobal(
			"matchMedia",
			(query: string) =>
				({
					matches: query === "(max-width: 640px)",
					addEventListener() {},
					removeEventListener() {},
				}) as unknown as MediaQueryList,
		);
		const props = setup({
			buffer: { type: BufferType.CHANNEL, name: "#c", joined: true },
			server: { bouncerNetID: "1" },
			onSearch: vi.fn(),
			onDetach: vi.fn(),
		});
		expect(buttons()).toEqual(["Open buffer list", "Open member list", "More actions"]);
		const more = screen.getByRole("button", { name: "More actions" });
		await userEvent.click(more);
		expect(more).toHaveAttribute("aria-expanded", "true");
		const items = screen.getAllByRole("menuitem");
		expect(items.map((i) => i.textContent)).toEqual(["Search", "Detach", "Leave"]);
		expect(items[0]).toHaveFocus();
		await userEvent.keyboard("{ArrowDown}{Enter}");
		expect(props.onDetach).toHaveBeenCalled();
		expect(screen.queryByRole("menu")).toBeNull();
		await userEvent.click(more);
		await userEvent.keyboard("{Escape}");
		expect(screen.queryByRole("menu")).toBeNull();
		expect(more).toHaveFocus();
	});

	it("shows Detach and Join as icons only", () => {
		setup({
			buffer: { type: BufferType.CHANNEL, name: "#c", joined: true },
			onDetach: vi.fn(),
		});
		expect(screen.getByRole("button", { name: "Detach" })).not.toHaveTextContent("Detach");
	});
});
