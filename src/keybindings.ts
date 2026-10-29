import {
	Unread,
	BufferType,
	compareUnread,
	displayedBuffers,
	receiptFromMessage,
	type Buffer,
} from "./state";
import type AppController from "./app/controller";
import { SMALL_SCREEN } from "./components/useMediaQuery";

function isSmallScreen(): boolean {
	return typeof window.matchMedia === "function" && window.matchMedia(SMALL_SCREEN).matches;
}

interface KeyBinding {
	key: string;
	altKey?: boolean;
	ctrlKey?: boolean;
	description: string;
	execute: (app: AppController) => void;
}

/** The buffer shown before or after the active one in the buffer list */
function getSiblingBuffer(app: AppController, delta: number): Buffer | null {
	const { buffers, servers, collapsedNetworks, activeBuffer } = app.state;
	const bufList = displayedBuffers(buffers, servers, collapsedNetworks, activeBuffer);
	let i = bufList.findIndex((buf) => buf.id === activeBuffer);
	if (i < 0) {
		return null;
	}
	i = (i + bufList.length + delta) % bufList.length;
	return bufList[i];
}

export const keybindings: KeyBinding[] = [
	{
		key: "h",
		altKey: true,
		description: "Mark all messages as read",
		execute: (app) => {
			for (const buf of [...app.state.buffers.values()]) {
				app.markBufferAsRead(buf.id);
				// Also drop the "new messages" separator, by moving it past
				// the last message. Without a receipt, all messages would be
				// new, with the separator above them all.
				const lastMsg = buf.messages.at(-1);
				if (lastMsg) {
					app.setBufferState(buf.id, { prevReadReceipt: receiptFromMessage(lastMsg) });
				}
			}
		},
	},
	{
		key: "a",
		altKey: true,
		description: "Jump to next buffer with activity",
		execute: (app) => {
			// TODO: order by age if same priority
			let firstServerBuffer: Buffer | null = null;
			let target: Buffer | null = null;
			for (const buf of app.state.buffers.values()) {
				if (!firstServerBuffer && buf.type === BufferType.SERVER) {
					firstServerBuffer = buf;
				}

				if (buf.unread === Unread.NONE) {
					continue;
				}

				if (!target || compareUnread(buf.unread, target.unread) > 0) {
					target = buf;
				}
			}
			if (!target) {
				target = firstServerBuffer;
			}
			if (target) {
				app.switchBuffer(target.id);
			}
		},
	},
	{
		key: "ArrowUp",
		altKey: true,
		description: "Jump to the previous buffer",
		execute: (app) => {
			const prev = getSiblingBuffer(app, -1);
			if (prev) {
				app.switchBuffer(prev.id);
			}
		},
	},
	{
		key: "ArrowDown",
		altKey: true,
		description: "Jump to the next buffer",
		execute: (app) => {
			const next = getSiblingBuffer(app, 1);
			if (next) {
				app.switchBuffer(next.id);
			}
		},
	},
	{
		key: "<",
		altKey: true,
		description: "Jump to the previously viewed buffer",
		execute: (app) => {
			const prev = app.previousBuffer;
			if (prev !== null && app.state.buffers.has(prev)) {
				app.switchBuffer(prev);
			}
		},
	},
	{
		key: "n",
		altKey: true,
		description: "Show or hide the member list",
		execute: (app) => {
			const buf =
				app.state.activeBuffer !== null ? app.state.buffers.get(app.state.activeBuffer) : null;
			if (buf?.type === BufferType.CHANNEL) {
				app.toggleMemberList(isSmallScreen());
			}
		},
	},
	{
		key: "l",
		altKey: true,
		description: "Focus the message input",
		execute: (app) => {
			app.ui.focusComposer?.();
		},
	},
	{
		key: "g",
		altKey: true,
		description: "Filter the buffer list",
		execute: (app) => {
			if (isSmallScreen()) {
				app.setOpenPanel("memberList", false);
				app.setOpenPanel("bufferList", true);
			} else if (app.state.bufferListHidden) {
				app.setBufferListHidden(false);
			}
			// The list may only be rendered now
			requestAnimationFrame(() => document.getElementById("buffer-filter")?.focus());
		},
	},
	{
		key: "f",
		altKey: true,
		description: "Search messages",
		execute: (app) => {
			app.openSearch("buffer");
		},
	},
	{
		key: "k",
		ctrlKey: true,
		description: "Switch to a buffer",
		execute: (app) => {
			app.openDialog({ kind: "switch" });
		},
	},
];

/** Install global key bindings. Returns a cleanup function. */
export function setup(app: AppController, target: Window = window): () => void {
	const byKey = new Map<string, KeyBinding[]>();
	for (const binding of keybindings) {
		const l = byKey.get(binding.key) ?? [];
		l.push(binding);
		byKey.set(binding.key, l);
	}

	const handleKeyDown = (event: KeyboardEvent) => {
		// With Caps Lock, letters come uppercase without Shift
		const key = event.key.length === 1 && !event.shiftKey ? event.key.toLowerCase() : event.key;
		let candidates = byKey.get(key);
		// On macOS, Alt+letter types another character (e.g. Alt+H is "˙"):
		// fall back to the physical key
		// Only when Alt didn't type a letter: some layouts need Alt for letters
		// (e.g. Polish "ą"), those must stay typeable
		if (!candidates && event.altKey && /^Key[A-Z]$/.test(event.code) && !/^\p{L}$/u.test(event.key)) {
			candidates = byKey.get(event.code.slice(3).toLowerCase());
		}
		// Alt+< is on the key left of Z on ISO keyboards, where the ` key
		// is on macOS, and types other characters on some layouts
		if (!candidates && event.altKey && (event.code === "IntlBackslash" || event.code === "Backquote")) {
			candidates = byKey.get("<");
		}
		if (!candidates) {
			return;
		}
		candidates = candidates.filter((binding) => {
			return Boolean(binding.altKey) === event.altKey && Boolean(binding.ctrlKey) === event.ctrlKey;
		});
		if (candidates.length !== 1) {
			return;
		}
		event.preventDefault();
		candidates[0].execute(app);
	};

	target.addEventListener("keydown", handleKeyDown);
	return () => target.removeEventListener("keydown", handleKeyDown);
}
