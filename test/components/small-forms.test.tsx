import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AuthForm from "../../src/components/forms/AuthForm";
import RegisterForm from "../../src/components/forms/RegisterForm";
import VerifyForm from "../../src/components/forms/VerifyForm";
import ConfirmOpenBuffer from "../../src/components/forms/ConfirmOpenBuffer";

describe("account forms", () => {
	it("logs in", async () => {
		const onSubmit = vi.fn();
		render(<AuthForm username="me" onSubmit={onSubmit} />);
		expect(screen.getByLabelText("Username")).toHaveValue("me");
		expect(screen.getByLabelText("Password")).toHaveFocus();
		await userEvent.type(screen.getByLabelText("Password"), "pw{Enter}");
		expect(onSubmit).toHaveBeenCalledWith("me", "pw");
	});

	it("registers, with an optional or required e-mail", async () => {
		const onSubmit = vi.fn();
		const { unmount } = render(<RegisterForm emailRequired={false} onSubmit={onSubmit} />);
		expect(screen.getByLabelText("E-mail")).not.toBeRequired();
		await userEvent.type(screen.getByLabelText("Password"), "pw");
		await userEvent.click(screen.getByRole("button", { name: "Create account" }));
		expect(onSubmit).toHaveBeenCalledWith("", "pw");
		unmount();
		render(<RegisterForm emailRequired onSubmit={onSubmit} />);
		expect(screen.getByLabelText("E-mail")).toBeRequired();
	});

	it("verifies accounts", async () => {
		const onSubmit = vi.fn();
		render(<VerifyForm account="me" message="Code sent to https://mail.example" onSubmit={onSubmit} />);
		expect(screen.getByRole("link", { name: "https://mail.example" })).toBeInTheDocument();
		await userEvent.type(screen.getByLabelText("Verification code"), "1234{Enter}");
		expect(onSubmit).toHaveBeenCalledWith("1234");
	});

	it("confirms opening buffers", async () => {
		const onSubmit = vi.fn();
		const { rerender } = render(
			<ConfirmOpenBuffer name="#chan" isChannel networkName="Libera" onSubmit={onSubmit} />,
		);
		expect(screen.getByText(/channel/)).toHaveTextContent(
			"Do you want to open a new buffer for channel #chan on Libera?",
		);
		await userEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(onSubmit).toHaveBeenCalled();
		rerender(<ConfirmOpenBuffer name="bob" isChannel={false} networkName={null} onSubmit={onSubmit} />);
		expect(screen.getByText(/user/)).toHaveTextContent("Do you want to open a new buffer for user bob?");
	});
});
