import { describe, expect, it } from "vitest";
import { setup } from "../src/keybindings";
import { getBuffer, isMessageBeforeReceipt, Unread } from "../src/state";
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

	it("navigates in the order of the buffer list", async () => {
		const { app, cleanup, name } = await withBuffers();
		// Pinned buffers come first
		const server = [...app.state.servers.values()][0];
		server.metadata.set("#b", { pinned: true });
		press("ArrowDown", { altKey: true });
		expect(name()).toBe("#b");
		press("ArrowDown", { altKey: true });
		expect(name()).toBe("#a");
		cleanup();
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

	it("drops the new messages separator when marking all as read", async () => {
		const { app, recv, cleanup } = await withBuffers();
		press("h", { altKey: true });
		// All messages are before the read marker: no separator is shown
		const buf = getBuffer(app.state, { name: "#b" })!;
		expect(buf.messages.length).toBeGreaterThan(0);
		expect(buf.messages.every((msg) => isMessageBeforeReceipt(msg, buf.prevReadReceipt))).toBe(true);
		// New messages still come after it
		recv("@time=2030-01-01T00:01:00.000Z :bob!u@h PRIVMSG #b :again");
		const msg = getBuffer(app.state, { name: "#b" })!.messages.at(-1)!;
		expect(isMessageBeforeReceipt(msg, buf.prevReadReceipt)).toBe(false);
		cleanup();
	});

	it("jumps back to the previous buffer", async () => {
		const { app, cleanup, name } = await withBuffers();
		app.switchBuffer(getBuffer(app.state, { name: "#a" })!.id);
		app.switchBuffer(getBuffer(app.state, { name: "#b" })!.id);
		expect(press("<", { altKey: true }).defaultPrevented).toBe(true);
		expect(name()).toBe("#a");
		// On the key left of Z, whatever it types
		press("≤", { code: "IntlBackslash", altKey: true });
		expect(name()).toBe("#b");
		cleanup();
	});

	it("toggles the member list of channels", async () => {
		const { app, cleanup } = await withBuffers();
		const shown = app.state.settings.showMemberList;
		press("n", { altKey: true });
		// Not in the server buffer
		expect(app.state.settings.showMemberList).toBe(shown);
		app.switchBuffer(getBuffer(app.state, { name: "#a" })!.id);
		press("n", { altKey: true });
		expect(app.state.settings.showMemberList).toBe(!shown);
		cleanup();
	});

	it("focuses the composer", async () => {
		const { app, cleanup } = await withBuffers();
		let focused = 0;
		const unregister = app.registerComposer(() => focused++);
		press("l", { altKey: true });
		expect(focused).toBe(1);
		unregister();
		cleanup();
	});

	it("shows the buffer list to filter it", async () => {
		const { app, cleanup } = await withBuffers();
		app.setBufferListHidden(true);
		press("g", { altKey: true });
		expect(app.state.bufferListHidden).toBe(false);
		cleanup();
	});

	it("matches Alt bindings on the physical key (macOS)", async () => {
		const { app, cleanup } = await withBuffers();
		app.setBufferState({ name: "#a" }, { unread: Unread.MESSAGE });
		expect(press("˙", { code: "KeyH", altKey: true }).defaultPrevented).toBe(true);
		expect(getBuffer(app.state, { name: "#a" })!.unread).toBe(Unread.NONE);
		cleanup();
	});

	it("lets Alt type letters of other layouts", async () => {
		const { cleanup, name } = await withBuffers();
		// Polish layout: Alt+A types "ą", it mustn't jump to a buffer
		expect(press("ą", { code: "KeyA", altKey: true }).defaultPrevented).toBe(false);
		expect(name()).toBe("*");
		cleanup();
	});

	it("works with Caps Lock, not with Shift", async () => {
		const { app, cleanup } = await withBuffers();
		expect(press("K", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
		press("K", { ctrlKey: true });
		expect(app.state.dialog).toEqual({ kind: "switch" });
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
