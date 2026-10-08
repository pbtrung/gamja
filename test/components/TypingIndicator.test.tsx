import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TypingIndicator from "../../src/components/TypingIndicator";
import { describeTyping } from "../../src/format";
import type { Buffer } from "../../src/state";

describe("TypingIndicator", () => {
	it("describes who is typing", () => {
		expect(describeTyping([])).toBeNull();
		expect(describeTyping(["a"])).toBe("a is typing…");
		expect(describeTyping(["a", "b"])).toBe("a and b are typing…");
		expect(describeTyping(["a", "b", "c"])).toBe("a, b and c are typing…");
		expect(describeTyping(["a", "b", "c", "d"])).toBe("Several people are typing…");
	});

	it("expires stale notifications", () => {
		vi.useFakeTimers();
		const buffer = {
			typing: new Map([["bob", { status: "active", time: Date.now() }]]),
		} as unknown as Buffer;
		render(<TypingIndicator buffer={buffer} />);
		expect(screen.getByText("bob is typing…")).toBeInTheDocument();
		act(() => vi.advanceTimersByTime(7000));
		expect(screen.queryByText("bob is typing…")).toBeNull();
	});
});
