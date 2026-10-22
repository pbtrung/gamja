import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatScroller from "../../src/components/ChatScroller";

// jsdom has no layout: a 1000px log in a 100px viewport, scrollTop clamped
const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 100;

beforeEach(() => {
	const tops = new WeakMap<Element, number>();
	vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(SCROLL_HEIGHT);
	vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(CLIENT_HEIGHT);
	vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
		return tops.get(this) ?? 0;
	});
	vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (this: Element, v: number) {
		tops.set(this, Math.max(0, Math.min(v, SCROLL_HEIGHT - CLIENT_HEIGHT)));
	});
});

let key = 0;

function setup() {
	key++;
	render(
		<ChatScroller scrollKey={`buffer-${key}`} stickTo=".msg" onScrollTop={vi.fn()} label="Messages">
			<div className="msg" data-key="1">
				hello
			</div>
		</ChatScroller>,
	);
	return screen.getByRole("log");
}

const latestButton = () => screen.queryByRole("button", { name: "Scroll to latest messages" });

describe("ChatScroller", () => {
	it("offers to scroll to the latest messages only when scrolled up", async () => {
		const log = setup();
		expect(log.scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT);
		expect(latestButton()).toBeNull();

		log.scrollTop = 400;
		fireEvent.scroll(log);
		expect(latestButton()).toBeInTheDocument();
		expect(latestButton()).not.toHaveTextContent(/\S/);

		await userEvent.click(latestButton()!);
		expect(log.scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT);
		expect(latestButton()).toBeNull();
	});

	it("hides the button when scrolled back to the bottom", () => {
		const log = setup();
		log.scrollTop = 200;
		fireEvent.scroll(log);
		expect(latestButton()).toBeInTheDocument();
		log.scrollTop = SCROLL_HEIGHT;
		fireEvent.scroll(log);
		expect(latestButton()).toBeNull();
	});

	it("restores the first visible message of a buffer, measuring few lines", () => {
		// 1000 lines of 10px: a line's top is its offset minus the scroll
		const lines = Array.from({ length: 1000 }, (_, i) => (
			<div key={i} className="msg" data-key={String(i)}>
				{i}
			</div>
		));
		let measured = 0;
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
			const el = this as HTMLElement;
			const log = el.closest("[role=log]");
			let top = 0;
			if (el.dataset.key && log) {
				measured++;
				top = Number(el.dataset.key) * 10 - log.scrollTop;
			}
			return { top, bottom: top + 10, left: 0, right: 0, width: 0, height: 10 } as DOMRect;
		});
		const props = { stickTo: ".msg", onScrollTop: vi.fn(), label: "Messages" };
		const { rerender } = render(
			<ChatScroller scrollKey="a" {...props}>
				{lines}
			</ChatScroller>,
		);
		const log = screen.getByRole("log");

		log.scrollTop = 405;
		measured = 0;
		fireEvent.scroll(log);
		expect(measured).toBeLessThan(20);

		// Line 41 is the first one in view, 5px down: it's put back there
		rerender(
			<ChatScroller scrollKey="b" {...props}>
				{lines}
			</ChatScroller>,
		);
		expect(log.scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT);
		rerender(
			<ChatScroller scrollKey="a" {...props}>
				{lines}
			</ChatScroller>,
		);
		expect(log.scrollTop).toBe(405);
	});
});
