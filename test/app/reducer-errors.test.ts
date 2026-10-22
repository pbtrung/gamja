import { describe, expect, it, vi } from "vitest";
import { connectedApp } from "../helpers/app";
import { getBuffer } from "../../src/state";

// Make the state reducer fail on one message, as a bug in it would
vi.mock("../../src/state", async (importOriginal) => {
	const S = await importOriginal<typeof import("../../src/state")>();
	return {
		...S,
		handleMessage: (...args: Parameters<typeof S.handleMessage>) => {
			if (args[1].params[1] === "boom") {
				throw new Error("reducer bug");
			}
			return S.handleMessage(...args);
		},
	};
});

describe("AppController", () => {
	it("keeps handling a message the state reducer failed on", async () => {
		const { app, recv } = await connectedApp();
		recv(":me!u@h JOIN #c");
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		recv("@time=2030-01-01T00:00:00.000Z :bob!u@h PRIVMSG #c :boom");
		expect(err).toHaveBeenCalledWith("Failed to handle message:", expect.anything(), expect.any(Error));
		// Still shown, and the connection keeps working
		const messages = getBuffer(app.state, { name: "#c" })!.messages;
		expect(messages.at(-1)!.params[1]).toBe("boom");
		recv("@time=2030-01-01T00:00:01.000Z :bob!u@h PRIVMSG #c :next");
		expect(getBuffer(app.state, { name: "#c" })!.messages.at(-1)!.params[1]).toBe("next");
	});
});
