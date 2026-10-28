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
		bufferListOpen: false,
		bufferListHidden: false,
		memberListOpen: false,
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
	it("shows a drawer toggle when the buffer list is hidden on large screens", async () => {
		const props = setup({ bufferListHidden: true });
		expect(document.querySelector(".leading .buffer-list-toggle svg.lucide-menu")).toBeInTheDocument();
		expect(document.querySelector(".actions .buffer-list-toggle")).toBeNull();
		await userEvent.click(screen.getByRole("button", { name: "Open buffer list" }));
		expect(props.onOpenBufferList).toHaveBeenCalled();
	});

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
		expect(buttons()).toEqual(["Open buffer list", "Manage network", "Settings"]);
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
		expect(buttons()).toEqual(["Open buffer list", "Open member list", "Search", "Leave", "Settings"]);
		await userEvent.click(screen.getByRole("button", { name: "Leave" }));
		expect(props.onClose).toHaveBeenCalled();
	});

	it("tells whether the side panels are open", () => {
		setup({
			buffer: { type: BufferType.CHANNEL, name: "#c", joined: true },
			memberListOpen: true,
		});
		const bufferList = screen.getByRole("button", { name: "Open buffer list" });
		expect(bufferList).toHaveAttribute("aria-expanded", "false");
		expect(bufferList).toHaveAttribute("aria-controls", "buffer-list");
		const memberList = screen.getByRole("button", { name: "Open member list" });
		expect(memberList).toHaveAttribute("aria-expanded", "true");
		expect(memberList).toHaveAttribute("aria-controls", "member-list");
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

	function stubSmallScreen() {
		vi.stubGlobal(
			"matchMedia",
			(query: string) =>
				({
					matches: query === "(max-width: 967.98px)",
					addEventListener() {},
					removeEventListener() {},
				}) as unknown as MediaQueryList,
		);
	}

	it("puts actions in a menu on small screens", async () => {
		stubSmallScreen();
		const props = setup({
			buffer: { type: BufferType.CHANNEL, name: "#c", joined: true },
			server: { bouncerNetID: "1" },
			onSearch: vi.fn(),
			onDetach: vi.fn(),
		});
		// [buffer list] [title and description] [menu] [member list]
		expect(buttons()).toEqual(["Open buffer list", "More actions", "Open member list"]);
		expect(document.querySelector(".leading .buffer-list-toggle")).toBeInTheDocument();
		// A drawer toggle: three horizontal lines
		expect(document.querySelector(".leading .buffer-list-toggle svg.lucide-menu")).toBeInTheDocument();
		expect(document.querySelector(".actions .buffer-list-toggle")).toBeNull();
		const more = screen.getByRole("button", { name: "More actions" });
		await userEvent.click(more);
		expect(more).toHaveAttribute("aria-expanded", "true");
		const items = screen.getAllByRole("menuitem");
		expect(items.map((i) => i.textContent)).toEqual(["Search", "Detach", "Leave", "Settings"]);
		expect(items[0]).toHaveFocus();
		await userEvent.keyboard("{ArrowDown}{Enter}");
		expect(props.onDetach).toHaveBeenCalled();
		expect(screen.queryByRole("menu")).toBeNull();
		// Choosing with the keyboard gives the focus back to the toggle
		expect(more).toHaveFocus();
		// Tab closes the menu and moves on from the toggle
		await userEvent.keyboard("{Enter}");
		expect(screen.getAllByRole("menuitem")[0]).toHaveFocus();
		await userEvent.tab({ shift: true });
		expect(screen.queryByRole("menu")).toBeNull();
		expect(screen.getByRole("button", { name: "Open buffer list" })).toHaveFocus();
		// Focus only goes back to the toggle for keyboard users
		await userEvent.click(more);
		await userEvent.keyboard("{Escape}");
		expect(screen.queryByRole("menu")).toBeNull();
		expect(more).not.toHaveFocus();
		more.focus();
		await userEvent.keyboard("{Enter}");
		expect(screen.getAllByRole("menuitem")[0]).toHaveFocus();
		await userEvent.keyboard("{Escape}");
		expect(screen.queryByRole("menu")).toBeNull();
		expect(more).toHaveFocus();
	});

	it("closes the small screen menu on outside clicks", async () => {
		stubSmallScreen();
		setup({ buffer: { type: BufferType.CHANNEL, name: "#c", joined: true } });
		await userEvent.click(screen.getByRole("button", { name: "More actions" }));
		expect(screen.getByRole("menu")).toBeInTheDocument();
		await userEvent.click(document.body);
		expect(screen.queryByRole("menu")).toBeNull();
	});

	it("only shows the member list toggle in channels on small screens", () => {
		stubSmallScreen();
		setup({ buffer: { type: BufferType.NICK, name: "alice" } });
		expect(buttons()).toEqual(["Open buffer list", "More actions"]);
	});

	it("labels the icon-only join channel button of networks", () => {
		setup({ server: { isBouncer: true, bouncerNetID: "1" } });
		const join = screen.getByRole("button", { name: "Join channel" });
		expect(join).toHaveAttribute("aria-label", "Join channel");
		expect(join.querySelector(".action-label")).toBeNull();
	});

	it("shows Detach and Join as icons only", () => {
		setup({
			buffer: { type: BufferType.CHANNEL, name: "#c", joined: true },
			onDetach: vi.fn(),
		});
		expect(screen.getByRole("button", { name: "Detach" })).not.toHaveTextContent("Detach");
	});
});
