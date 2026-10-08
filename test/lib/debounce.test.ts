import { expect, it, vi } from "vitest";
import debounce from "../../src/lib/debounce";

it("debounces calls", () => {
	vi.useFakeTimers();
	const f = vi.fn();
	const g = debounce(f, 100);
	g(1);
	g(2);
	vi.advanceTimersByTime(99);
	expect(f).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1);
	expect(f).toHaveBeenCalledExactlyOnceWith(2);
});
