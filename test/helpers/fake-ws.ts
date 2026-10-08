import { vi } from "vitest";
import { formatMessage, parseMessage, type Message, type OutgoingMessage } from "../../src/lib/irc";

/**
 * In-memory WebSocket replacement. The test plays the server: it reads what
 * the client sent with `sent`/`takeSent()` and feeds lines with `receive()`.
 */
export class FakeWebSocket extends EventTarget {
	static instances: FakeWebSocket[] = [];

	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	url: string;
	readyState = FakeWebSocket.CONNECTING;
	sent: string[] = [];
	closeCode: number | null = null;

	constructor(url: string) {
		super();
		this.url = url;
		FakeWebSocket.instances.push(this);
	}

	static last(): FakeWebSocket {
		const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
		if (!ws) {
			throw new Error("No WebSocket created");
		}
		return ws;
	}

	send(data: string): void {
		if (this.readyState !== FakeWebSocket.OPEN) {
			throw new Error("WebSocket is not open");
		}
		this.sent.push(data);
	}

	close(code = 1000): void {
		if (this.readyState === FakeWebSocket.CLOSED) {
			return;
		}
		this.closeCode = code;
		this.readyState = FakeWebSocket.CLOSED;
		queueMicrotask(() => this.dispatchEvent(new CloseEvent("close", { code })));
	}

	// Server-side helpers

	open(): void {
		this.readyState = FakeWebSocket.OPEN;
		this.dispatchEvent(new Event("open"));
	}

	receive(...lines: (string | OutgoingMessage)[]): void {
		for (const line of lines) {
			const data = typeof line === "string" ? line : formatMessage(line);
			this.dispatchEvent(new MessageEvent("message", { data }));
		}
	}

	serverClose(code = 1006): void {
		this.readyState = FakeWebSocket.CLOSED;
		this.dispatchEvent(new CloseEvent("close", { code }));
	}

	/** Parsed messages sent by the client since the last call. */
	takeSent(): Message[] {
		const l = this.sent.map((raw) => parseMessage(raw));
		this.sent = [];
		return l;
	}

	sentCommands(): string[] {
		return this.sent.map((raw) => parseMessage(raw).command);
	}
}

export function installFakeWebSocket(): void {
	FakeWebSocket.instances = [];
	vi.stubGlobal("WebSocket", FakeWebSocket);
}
