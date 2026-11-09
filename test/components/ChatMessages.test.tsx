import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ControllerContext } from "../../src/app/context";
import ChatMessages from "../../src/components/ChatMessages";
import { parseMessage } from "../../src/lib/irc";
import { getBuffer, Unread } from "../../src/state";
import { connectedApp } from "../helpers/app";

it.each(["", ";msgid=history"])(
	"shows IdleRPG messages once when opening a channel loads overlapping history (%s)",
	async (historyID) => {
		const { app, serverID, recv } = await connectedApp();
		recv("@time=2024-01-01T00:00:00.000Z :me!u@h JOIN #idlerpg");
		const id = getBuffer(app.state, { name: "#idlerpg" })!.id;
		app.setBufferState(id, { hasInitialWho: true });
		app.switchBuffer(id);
		const client = app.clients.get(serverID)!;
		const history = Promise.withResolvers<Awaited<ReturnType<typeof client.fetchHistoryBefore>>>();
		vi.spyOn(client, "fetchHistoryBefore").mockReturnValue(history.promise);
		const text = "DiamantThomy reaches next level in 9 days, 10:23:54.";
		const message = (tags: string) =>
			parseMessage(
				`@time=2026-11-07T23:02:29.000Z${tags} :RizonIRPG!bot@host PRIVMSG #idlerpg :${text}`,
			);
		const { unmount } = render(
			<ControllerContext.Provider value={app}>
				<ChatMessages onChannelClick={vi.fn()} />
			</ControllerContext.Provider>,
		);
		try {
			await act(async () => app.applyHistory(serverID, [message("")], { live: true }));
			await act(async () =>
				history.resolve({ messages: [message(`${historyID};batch=older`)], more: false }),
			);
			expect(app.state.buffers.get(id)!.history).toBe("end");
			expect(app.state.buffers.get(id)!.messages).toHaveLength(1);
			expect(screen.getAllByText(text)).toHaveLength(1);
		} finally {
			unmount();
			app.destroy();
		}
	},
);

it.each(["read marker", "unread snapshot", "live messages"])(
	"keeps the opening pill for eight seconds while off-screen history arrives (%s)",
	async (source) => {
		const { app, serverID, recv } = await connectedApp();
		recv("@time=2024-01-01T00:00:00.000Z :me!u@h JOIN #c");
		const id = getBuffer(app.state, { name: "#c" })!.id;
		app.setBufferState(id, { messages: [], hasInitialWho: true });
		if (source === "read marker") {
			recv(":srv MARKREAD #c timestamp=2024-01-01T00:00:00.000Z");
		} else if (source === "unread snapshot") {
			app.setBufferState(id, {
				unreadSnapshot: { latestMessage: "2025-01-01T12:00:00.000Z", level: Unread.MESSAGE },
			});
		}
		app.switchBuffer(id);
		const marker = app.state.buffers.get(id)!.prevReadReceipt;
		const client = app.clients.get(serverID)!;
		const history = Promise.withResolvers<Awaited<ReturnType<typeof client.fetchHistoryBefore>>>();
		const fetchHistory = vi.spyOn(client, "fetchHistoryBefore").mockReturnValue(history.promise);
		vi.useFakeTimers();
		const { unmount } = render(
			<ControllerContext.Provider value={app}>
				<ChatMessages onChannelClick={vi.fn()} />
			</ControllerContext.Provider>,
		);
		try {
			expect(fetchHistory).toHaveBeenCalledOnce();
			const message = parseMessage(
				"@time=2025-01-01T12:00:00.000Z;msgid=missed :bob!u@h PRIVMSG #c :missed message",
			);
			await act(async () => app.applyHistory(serverID, [message], { live: true }));
			const banner = () => screen.queryByRole("button", { name: /^1\+? new since / });
			expect(banner()).toBeInTheDocument();
			act(() => vi.advanceTimersByTime(4000));
			await act(async () => history.resolve({ messages: [message], more: false }));
			expect(app.state.buffers.get(id)!.history).toBe("end");
			expect(app.state.buffers.get(id)!.prevReadReceipt).toEqual(marker);
			expect(banner()).toBeInTheDocument();
			act(() => vi.advanceTimersByTime(3999));
			expect(banner()).toBeInTheDocument();
			act(() => vi.advanceTimersByTime(1));
			await act(async () => {});
			expect(banner()).toBeNull();
			expect(document.querySelector(".unread-separator")).toBeInTheDocument();
		} finally {
			unmount();
			app.destroy();
		}
	},
);
