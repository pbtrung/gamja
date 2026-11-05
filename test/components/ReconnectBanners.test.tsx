import { act, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ControllerContext } from "../../src/app/context";
import Banners from "../../src/components/app/Banners";
import { connectedApp, flush } from "../helpers/app";

it("groups a multiplex outage and preserves an isolated network's identity", async () => {
	const { app, ws, serverID, recv } = await connectedApp({
		caps: "batch cap-notify soju.im/bouncer-networks soju.im/multiplex",
	});
	const parent = app.clients.get(serverID)!;
	const mux = parent.getMultiplexer();
	const first = app.connect({ nick: "me", bouncerNetwork: "1" }, mux);
	const second = app.connect({ nick: "me", bouncerNetwork: "2" }, mux);
	await flush();
	recv(
		"@soju.im/network=1 :srv 001 me :Welcome",
		"@soju.im/network=1 :srv 005 me NETWORK=First BOUNCER_NETID=1 :ok",
		"@soju.im/network=2 :srv 001 me :Welcome",
		"@soju.im/network=2 :srv 005 me NETWORK=Second BOUNCER_NETID=2 :ok",
	);
	const view = () => (
		<ControllerContext.Provider value={app}>
			<Banners state={app.state} />
		</ControllerContext.Provider>
	);
	const { rerender, unmount } = render(view());
	try {
		expect(screen.queryByRole("status")).toBeNull();
		// A network can fail without closing the physical transport.
		act(() => recv("@soju.im/network=1 ERROR :Closing link"));
		await act(() => flush());
		rerender(view());
		expect(screen.getAllByRole("status")).toHaveLength(1);
		expect(screen.getByRole("status")).toHaveTextContent("Connection to First lost.");
		// Losing the shared transport also drops the other network.
		act(() => ws.serverClose(1000));
		await act(() => flush());
		rerender(view());
		expect(app.state.servers.get(first)!.reconnecting).toBe(true);
		expect(app.state.servers.get(second)!.reconnecting).toBe(true);
		expect(screen.getAllByRole("status")).toHaveLength(1);
		expect(screen.getByRole("status")).toHaveTextContent("Connection to TestNet lost.");
		// Keep one banner while the transport is back but networks reattach.
		act(() => app.setServerState(serverID, { reconnecting: false }));
		rerender(view());
		expect(screen.getAllByRole("status")).toHaveLength(1);
		act(() => {
			app.setServerState(first, { reconnecting: false });
			app.setServerState(second, { reconnecting: false });
		});
		rerender(view());
		expect(screen.queryByRole("status")).toBeNull();
	} finally {
		unmount();
		app.destroy();
	}
});
