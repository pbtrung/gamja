import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PaneResizer from "../../src/components/PaneResizer";
import { Item } from "../../src/store";

function setup(side: "left" | "right", paneWidth = 240) {
	const item = new Item<number>(`test-width-${side}`);
	item.put(null);
	render(
		<div>
			<PaneResizer side={side} label="Resize" controls="pane" cssVariable="--test-width" item={item} />
		</div>,
	);
	const handle = screen.getByRole("separator", { name: "Resize" });
	vi.spyOn(handle.parentElement!, "clientWidth", "get").mockReturnValue(paneWidth);
	const width = () => document.documentElement.style.getPropertyValue("--test-width");
	return { item, handle, width };
}

describe("PaneResizer", () => {
	it("resizes with the arrow keys and remembers the width", () => {
		const { item, handle, width } = setup("left");
		fireEvent.keyDown(handle, { key: "ArrowRight" });
		expect(width()).toBe("256px");
		expect(item.load()).toBe(256);
		expect(handle).toHaveAttribute("aria-valuenow", "256");
	});

	it("moves the inner edge of panes on the right", () => {
		const { handle, width } = setup("right");
		fireEvent.keyDown(handle, { key: "ArrowRight" });
		expect(width()).toBe("224px");
	});

	it("keeps the width within bounds", () => {
		const { handle, width } = setup("left", 470);
		fireEvent.keyDown(handle, { key: "ArrowRight" });
		expect(width()).toBe("480px");
	});

	it("goes back to the default width on double click", () => {
		const { item, handle, width } = setup("left");
		fireEvent.keyDown(handle, { key: "ArrowRight" });
		fireEvent.doubleClick(handle);
		expect(width()).toBe("");
		expect(item.load()).toBeNull();
	});
});
