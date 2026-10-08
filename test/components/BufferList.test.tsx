import { render, screen, within } from "@testing-library/react";
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
});
