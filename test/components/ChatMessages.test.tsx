import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ControllerContext } from "../../src/app/context";
import ChatMessages from "../../src/components/ChatMessages";
import { parseMessage } from "../../src/lib/irc";
import { getBuffer, Unread } from "../../src/state";
import { connectedApp } from "../helpers/app";

it.each(["read marker", "unread snapshot", "live messages"])(
	"keeps the first-open banner when initial history finishes after missed messages (%s)",
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
			const banner = () => screen.queryByRole("button", { name: /^1 new message since / });
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
		} finally {
			unmount();
			app.destroy();
		}
	},
);
