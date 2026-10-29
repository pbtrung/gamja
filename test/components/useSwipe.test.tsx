import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useSwipe from "../../src/components/useSwipe";

function touch(type: string, x: number, y: number, target: EventTarget = document.body) {
	const point = { clientX: x, clientY: y };
	const event = Object.assign(new Event(type, { bubbles: true }), {
		touches: type === "touchstart" ? [point] : [],
		changedTouches: [point],
	});
	target.dispatchEvent(event);
}

function swipe(fromX: number, toX: number, dy = 0, target?: EventTarget) {
	touch("touchstart", fromX, 100, target);
	touch("touchend", toX, 100 + dy, target);
}

describe("useSwipe", () => {
	it("reports horizontal swipes", () => {
		const onSwipe = vi.fn();
		renderHook(() => useSwipe(true, onSwipe));
		swipe(10, 200);
		swipe(200, 10);
		expect(onSwipe.mock.calls).toEqual([["right"], ["left"]]);
	});

	it("ignores short or mostly vertical moves", () => {
		const onSwipe = vi.fn();
		renderHook(() => useSwipe(true, onSwipe));
		swipe(10, 50);
		swipe(10, 200, 150);
		expect(onSwipe).not.toHaveBeenCalled();
	});

	it("ignores swipes in text fields and while disabled", () => {
		const onSwipe = vi.fn();
		const { rerender } = renderHook(({ enabled }) => useSwipe(enabled, onSwipe), {
			initialProps: { enabled: true },
		});
		const input = document.body.appendChild(document.createElement("textarea"));
		swipe(10, 200, 0, input);
		input.remove();
		rerender({ enabled: false });
		swipe(10, 200);
		expect(onSwipe).not.toHaveBeenCalled();
	});
});
