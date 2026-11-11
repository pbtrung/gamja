import { expect, it, vi } from "vitest";
import { connectedApp } from "../helpers/app";

const caps = "batch server-time soju.im/search";

it("continues queued searches after the first request fails", async () => {
	const { app, serverID, recv, sent } = await connectedApp({ caps });
	const client = app.clients.get(serverID)!;
	try {
		const first = client.search({ text: "first" });
		const failed = expect(first).rejects.toThrow("Invalid parameters");
		const second = client.search({ text: "second" });
		expect(sent()).toEqual(["SEARCH text=first"]);
		recv(":srv FAIL SEARCH INVALID_PARAMS :Invalid parameters");
		await failed;
		expect(sent()).toEqual(["SEARCH text=second"]);
		recv(
			":srv BATCH +second soju.im/search",
			"@batch=second :bob PRIVMSG #c :found",
			":srv BATCH -second",
		);
		expect((await second).map((msg) => msg.params[1])).toEqual(["found"]);
		expect(client.pendingSearch).toBeNull();
	} finally {
		app.destroy();
	}
});

it("rejects old queued searches after reconnecting instead of sending them on the new socket", async () => {
	const { app, serverID } = await connectedApp({ caps });
	const client = app.clients.get(serverID)!;
	try {
		const results = Promise.allSettled([
			client.search({ text: "first" }),
			client.search({ text: "second" }),
		]);
		client.reconnect();
		const send = vi.spyOn(client, "send");
		expect((await results).map((r) => r.status)).toEqual(["rejected", "rejected"]);
		expect(send).not.toHaveBeenCalled();
	} finally {
		app.destroy();
	}
});

it("releases the search queue after a lost reply times out", async () => {
	const { app, serverID, recv, sent } = await connectedApp({ caps });
	const client = app.clients.get(serverID)!;
	vi.useFakeTimers();
	try {
		const first = client.search({ text: "lost" });
		const timedOut = expect(first).rejects.toThrow("Timed out waiting for SEARCH");
		const second = client.search({ text: "retry" });
		sent();
		await vi.advanceTimersByTimeAsync(60_000);
		await timedOut;
		expect(sent()).toContain("SEARCH text=retry");
		recv(":srv BATCH +retry soju.im/search", ":srv BATCH -retry");
		await expect(second).resolves.toEqual([]);
	} finally {
		app.destroy();
	}
});
