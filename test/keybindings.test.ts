import { describe, expect, it } from "vitest";
import { setup } from "../src/keybindings";
import { getBuffer, Unread } from "../src/state";
import { connectedApp } from "./helpers/app";

function press(key: string, opts: KeyboardEventInit = {}) {
	const event = new KeyboardEvent("keydown", { key, cancelable: true, ...opts });
	window.dispatchEvent(event);
	return event;
}

async function withBuffers() {
	const h = await connectedApp();
	h.recv(
		":me!u@h JOIN #a",
		":me!u@h JOIN #b",
		"@time=2030-01-01T00:00:00.000Z :bob!u@h PRIVMSG #b :hey me",
	);
	const cleanup = setup(h.app);
	return { ...h, cleanup, name: () => getBuffer(h.app.state, h.app.state.activeBuffer)!.name };
}

describe("keybindings", () => {
	it("navigates between buffers", async () => {
		const { cleanup, name } = await withBuffers();
		expect(name()).toBe("*");
		expect(press("ArrowDown", { altKey: true }).defaultPrevented).toBe(true);
		expect(name()).toBe("#a");
		press("ArrowUp", { altKey: true });
		press("ArrowUp", { altKey: true });
		expect(name()).toBe("#b");
		cleanup();
		press("ArrowDown", { altKey: true });
		expect(name()).toBe("#b");
	});

	it("jumps to activity and marks everything as read", async () => {
		const { app, cleanup, name } = await withBuffers();
		press("a", { altKey: true });
		expect(name()).toBe("#b");
		app.setBufferState({ name: "#a" }, { unread: Unread.MESSAGE });
		press("h", { altKey: true });
		expect([...app.state.buffers.values()].every((b) => b.unread === Unread.NONE)).toBe(true);
		press("a", { altKey: true });
		expect(name()).toBe("*");
		cleanup();
	});

	it("opens the switcher and search, ignoring other modifiers", async () => {
		const { app, cleanup } = await withBuffers();
		expect(press("k", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
		press("k", { ctrlKey: true });
		expect(app.state.dialog).toEqual({ kind: "switch" });
		cleanup();
	});
});
