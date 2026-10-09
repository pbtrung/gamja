import { render, screen, within } from "@testing-library/react";
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
