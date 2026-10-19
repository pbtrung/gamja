import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BufferList from "../../src/components/BufferList";
import * as S from "../../src/state";
import * as irc from "../../src/lib/irc";
import type Client from "../../src/lib/client";

describe("BufferList", () => {
	it("lists pinned buffers right after their server and marks muted ones", () => {
		const client = {
			isChannel: (name: string) => name.startsWith("#"),
			cm: irc.CaseMapping.RFC1459,
		} as unknown as Client;
		let state = S.createState();
		const [serverID, update] = S.createServer(state);
		state = { ...state, ...update };
		for (const name of [S.SERVER_BUFFER, "#a", "#b", "#c"]) {
			state = { ...state, ...S.createBuffer(state, name, serverID, client)[1] };
		}
		const server = state.servers.get(serverID)!;
		server.metadata.set("#c", { pinned: true });
		server.metadata.set("#b", { muted: true });
		render(
			<BufferList
				buffers={state.buffers}
				servers={state.servers}
				bouncerNetworks={new Map()}
				activeBuffer={null}
				onBufferClick={vi.fn()}
				onBufferClose={vi.fn()}
			/>,
		);
		const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
		expect(tabs.slice(1).map((t) => t.textContent)).toEqual(["#c", "#a", "#b"]);
		expect(tabs[1]).toHaveAttribute("aria-description", "Pinned");
		expect(tabs[3].closest("li")).toHaveClass("muted");
	});

	it("closes buffers on middle click, without opening the link", () => {
		const client = {
			isChannel: (name: string) => name.startsWith("#"),
			cm: irc.CaseMapping.RFC1459,
		} as unknown as Client;
		let state = S.createState();
		const [serverID, update] = S.createServer(state);
		state = { ...state, ...update };
		for (const name of [S.SERVER_BUFFER, "#a"]) {
			state = { ...state, ...S.createBuffer(state, name, serverID, client)[1] };
		}
		const onBufferClose = vi.fn();
		render(
			<BufferList
				buffers={state.buffers}
				servers={state.servers}
				bouncerNetworks={new Map()}
				activeBuffer={null}
				onBufferClick={vi.fn()}
				onBufferClose={onBufferClose}
			/>,
		);
		const tab = screen.getByRole("tab", { name: /#a/ });
		expect(fireEvent.mouseDown(tab, { button: 1 })).toBe(false);
		expect(onBufferClose).not.toHaveBeenCalled();
		expect(
			fireEvent(tab, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 })),
		).toBe(false);
		expect(onBufferClose).toHaveBeenCalledWith(expect.objectContaining({ name: "#a" }));
	});

	it("moves between buffers with the arrow keys, from a single Tab stop", async () => {
		const client = {
			isChannel: (name: string) => name.startsWith("#"),
			cm: irc.CaseMapping.RFC1459,
		} as unknown as Client;
		let state = S.createState();
		const [serverID, update] = S.createServer(state);
		state = { ...state, ...update };
		for (const name of [S.SERVER_BUFFER, "#a", "#b"]) {
			state = { ...state, ...S.createBuffer(state, name, serverID, client)[1] };
		}
		const ids = [...state.buffers.keys()];
		const onBufferClick = vi.fn();
		const props = {
			buffers: state.buffers,
			servers: state.servers,
			bouncerNetworks: new Map(),
			onBufferClick,
			onBufferClose: vi.fn(),
		};
		const { rerender } = render(<BufferList {...props} activeBuffer={null} />);
		const tabs = () => within(screen.getByRole("tablist")).getAllByRole("tab");
		const tabIndexes = () => tabs().map((t) => t.tabIndex);
		// Without an active buffer, the first one
		expect(tabIndexes()).toEqual([0, -1, -1]);
		rerender(<BufferList {...props} activeBuffer={ids[1]} />);
		expect(tabIndexes()).toEqual([-1, 0, -1]);
		expect(tabs()[1]).not.toHaveAttribute("aria-current");

		await userEvent.tab();
		expect(tabs()[1]).toHaveFocus();
		await userEvent.keyboard("{ArrowDown}");
		expect(tabs()[2]).toHaveFocus();
		await userEvent.keyboard("{ArrowDown}");
		expect(tabs()[0]).toHaveFocus();
		await userEvent.keyboard("{End}");
		expect(tabs()[2]).toHaveFocus();
		await userEvent.keyboard("{Home}{ArrowUp}");
		expect(tabs()[2]).toHaveFocus();
		// Moving doesn't switch buffers, Enter and Space do
		expect(onBufferClick).not.toHaveBeenCalled();
		await userEvent.keyboard(" ");
		expect(onBufferClick).toHaveBeenLastCalledWith(state.buffers.get(ids[2]));
		await userEvent.keyboard("{ArrowUp}{Enter}");
		expect(onBufferClick).toHaveBeenLastCalledWith(state.buffers.get(ids[1]));
	});

	it("collapses a network to its pinned, active and highlighted buffers", async () => {
		const client = {
			isChannel: (name: string) => name.startsWith("#"),
			cm: irc.CaseMapping.RFC1459,
		} as unknown as Client;
		let state = S.createState();
		const [serverID, update] = S.createServer(state);
		state = { ...state, ...update };
		for (const name of [
			S.SERVER_BUFFER,
			"#pinned",
			"#active",
			"#mention",
			"#unread",
			"#muted",
			"#quiet",
		]) {
			state = { ...state, ...S.createBuffer(state, name, serverID, client)[1] };
		}
		const server = state.servers.get(serverID)!;
		server.metadata.set("#pinned", { pinned: true });
		server.metadata.set("#muted", { muted: true });
		const unread: Record<string, S.Unread> = {
			"#mention": S.Unread.HIGHLIGHT,
			"#unread": S.Unread.MESSAGE,
			"#muted": S.Unread.MESSAGE,
		};
		const buffers = new Map(
			[...state.buffers].map(([id, buf]) => [
				id,
				{ ...buf, unread: unread[buf.name] ?? S.Unread.NONE },
			]),
		);
		const active = [...buffers.values()].find((b) => b.name === "#active")!.id;
		const onToggleCollapse = vi.fn();
		const props = {
			buffers,
			servers: state.servers,
			bouncerNetworks: new Map(),
			activeBuffer: active,
			onBufferClick: vi.fn(),
			onBufferClose: vi.fn(),
			onToggleCollapse,
		};
		const { rerender } = render(<BufferList {...props} />);
		const names = () =>
			within(screen.getByRole("tablist"))
				.getAllByRole("tab")
				.map((t) => t.textContent);
		const serverTab = () => screen.getAllByRole("tab")[0];
		expect(names()).toHaveLength(7);
		expect(serverTab()).toHaveAttribute("aria-expanded", "true");

		rerender(<BufferList {...props} collapsed={new Set([S.getServerKey(server)])} />);
		// The muted buffer's unread messages don't count
		expect(names()).toEqual(["server1", "#pinned", "#active", "#mention"]);
		expect(serverTab()).toHaveAttribute("aria-expanded", "false");
		expect(serverTab()).toHaveAttribute("aria-description", "Disconnected, 1 more unread buffer");

		await userEvent.click(serverTab().querySelector(".buffer-collapse")!);
		expect(onToggleCollapse).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: S.BufferType.SERVER }),
			false,
		);
		expect(props.onBufferClick).not.toHaveBeenCalled();
		serverTab().focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(onToggleCollapse).toHaveBeenCalledTimes(2);
		await userEvent.keyboard("{ArrowLeft}");
		expect(onToggleCollapse).toHaveBeenCalledTimes(2);
	});
});
