import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Dialog from "../../src/components/Dialog";

describe("Dialog", () => {
	it("is labelled, focuses autofocus fields and dismisses with Escape", async () => {
		const onDismiss = vi.fn();
		render(
			<Dialog title="Join channel" onDismiss={onDismiss}>
				<input aria-label="first" />
				<input aria-label="channel" autoFocus />
			</Dialog>,
		);
		expect(screen.getByRole("dialog", { name: "Join channel" })).toBeInTheDocument();
		expect(screen.getByLabelText("channel")).toHaveFocus();
		await userEvent.keyboard("{Escape}");
		expect(onDismiss).toHaveBeenCalledOnce();
	});

	it("traps focus", async () => {
		render(
			<Dialog title="T" onDismiss={() => {}}>
				<input aria-label="only" autoFocus />
			</Dialog>,
		);
		await userEvent.tab();
		expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
		await userEvent.tab();
		expect(screen.getByLabelText("only")).toHaveFocus();
	});

	it("closes on backdrop click and close button", async () => {
		const onDismiss = vi.fn();
		const { container } = render(
			<Dialog title="T" onDismiss={onDismiss}>
				<p>body</p>
			</Dialog>,
		);
		await userEvent.click(screen.getByText("body"));
		expect(onDismiss).not.toHaveBeenCalled();
		await userEvent.click(container.querySelector(".dialog-backdrop")!);
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(onDismiss).toHaveBeenCalledTimes(2);
	});
});

describe("Dialog focus restoration", () => {
	it("restores focus to the opener on close", () => {
		const opener = document.createElement("button");
		document.body.appendChild(opener);
		opener.focus();
		const { unmount } = render(
			<Dialog title="T" onDismiss={() => {}}>
				<input aria-label="x" autoFocus />
			</Dialog>,
		);
		expect(screen.getByLabelText("x")).toHaveFocus();
		unmount();
		expect(opener).toHaveFocus();
		opener.remove();
	});
});
