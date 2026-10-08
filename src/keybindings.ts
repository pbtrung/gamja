import { Unread, BufferType, compareUnread, type Buffer } from "./state";
import type AppController from "./app/controller";

export interface KeyBinding {
	key: string;
	altKey?: boolean;
	ctrlKey?: boolean;
	description: string;
	execute: (app: AppController) => void;
}

function getSiblingBuffer(buffers: Map<number, Buffer>, bufID: number | null, delta: number): Buffer | null {
	const bufList = Array.from(buffers.values());
	let i = bufList.findIndex((buf) => buf.id === bufID);
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
			for (const id of [...app.state.buffers.keys()]) {
				app.markBufferAsRead(id);
				// Also drop the "new messages" separator
				app.setBufferState(id, { prevReadReceipt: null });
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
			const prev = getSiblingBuffer(app.state.buffers, app.state.activeBuffer, -1);
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
			const next = getSiblingBuffer(app.state.buffers, app.state.activeBuffer, 1);
			if (next) {
				app.switchBuffer(next.id);
			}
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
		let candidates = byKey.get(event.key);
		// On macOS, Alt+letter types another character (e.g. Alt+H is "˙"):
		// fall back to the physical key
		// Only when Alt didn't type a letter: some layouts need Alt for letters
		// (e.g. Polish "ą"), those must stay typeable
		if (!candidates && event.altKey && /^Key[A-Z]$/.test(event.code) && !/^\p{L}$/u.test(event.key)) {
			candidates = byKey.get(event.code.slice(3).toLowerCase());
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
