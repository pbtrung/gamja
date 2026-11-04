import { act, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ColumnPrefix from "../../src/components/messages/ColumnPrefix";

it("marks overflow and clears the marker when the nickname fits again", () => {
	let contentWidth = 140;
	vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => contentWidth);
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
	let resize!: () => void;
	const disconnect = vi.fn();
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: () => void) {
				resize = callback;
			}
			observe = vi.fn();
			disconnect = disconnect;
		},
	);
	const { container, unmount } = render(
		<ColumnPrefix kind="nick">
			<a href="#nick">a-long-nickname</a>
		</ColumnPrefix>,
	);
	const prefix = container.querySelector(".logline-prefix")!;
	expect(prefix).toHaveAttribute("data-truncated");
	expect(prefix.querySelector("a")).toHaveTextContent("a-long-nickname");
	expect(prefix.querySelector(".logline-prefix-overflow")).toHaveAttribute("aria-hidden", "true");
	contentWidth = 100;
	act(() => resize());
	expect(prefix).not.toHaveAttribute("data-truncated");
	contentWidth = 120;
	act(() => resize());
	expect(prefix).toHaveAttribute("data-truncated");
	unmount();
	expect(disconnect).toHaveBeenCalled();
});
