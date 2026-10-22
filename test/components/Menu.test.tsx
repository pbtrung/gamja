import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import Menu from "../../src/components/Menu";

const items = [
	{ key: "edit", icon: Pencil, label: "Edit", onClick: vi.fn() },
	{ key: "copy", icon: Copy, label: "Copy", onClick: vi.fn() },
	{ key: "delete", icon: Trash2, label: "Delete", danger: true, onClick: vi.fn() },
];

describe("Menu", () => {
	it("moves between items with the arrow, Home and End keys", async () => {
		render(<Menu items={items} label="Actions" toggleLabel="More actions" />);
		await userEvent.click(screen.getByRole("button", { name: "More actions" }));
		expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();

		await userEvent.keyboard("{ArrowDown}");
		expect(screen.getByRole("menuitem", { name: "Copy" })).toHaveFocus();
		await userEvent.keyboard("{End}");
		expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
		await userEvent.keyboard("{ArrowDown}");
		expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
		await userEvent.keyboard("{ArrowUp}");
		expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
		await userEvent.keyboard("{Home}");
		expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
	});
});
