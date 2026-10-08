import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Composer from "../../src/components/Composer";
import { computeAutocomplete } from "../../src/lib/autocomplete";
import * as irc from "../../src/lib/irc";
import type Client from "../../src/lib/client";

function setup(props: Partial<Parameters<typeof Composer>[0]> = {}) {
	const onSubmit = vi.fn();
	const utils = render(
		<Composer
			client={null}
			readOnly={false}
			commandOnly={false}
			onSubmit={onSubmit}
			onError={() => {}}
			autocomplete={(prefix) => ["alice", "albert", "bob"].filter((n) => n.startsWith(prefix))}
			{...props}
		/>,
	);
	return { ...utils, onSubmit, input: screen.getByRole("textbox") as HTMLTextAreaElement };
}

describe("Composer", () => {
	it("submits with Enter and clears", async () => {
		const { input, onSubmit } = setup();
		expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
		await userEvent.type(input, "hello{Enter}");
		expect(onSubmit).toHaveBeenCalledWith("hello");
		expect(input).toHaveValue("");
	});

	it("submits with the send button", async () => {
		const { input, onSubmit } = setup();
		await userEvent.type(input, "hi");
		await userEvent.click(screen.getByRole("button", { name: "Send" }));
		expect(onSubmit).toHaveBeenCalledWith("hi");
	});

	it("tab-completes nicks and cycles", async () => {
		const { input } = setup();
		await userEvent.type(input, "al");
		await userEvent.keyboard("{Tab}");
		expect(input).toHaveValue("alice: ");
		await userEvent.keyboard("{Tab}");
		expect(input).toHaveValue("albert: ");
		await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
		expect(input).toHaveValue("alice: ");
	});

	it("starts typing from anywhere on the page", async () => {
		const { input } = setup();
		input.blur();
		await userEvent.keyboard("x");
		expect(input).toHaveFocus();
		expect(input).toHaveValue("x");
	});

	it("only accepts commands in command-only mode", async () => {
		const { input } = setup({ commandOnly: true });
		input.blur();
		await userEvent.keyboard("x");
		expect(input).toHaveValue("");
		expect(input).toHaveAttribute("placeholder", "Type a command (see /help)");
	});

	it("flags messages that are too long", async () => {
		const { input } = setup({ maxLen: 3 });
		await userEvent.type(input, "abcd");
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
	});

	it("doesn't send over-length messages with Enter, but allows commands", async () => {
		const { input, onSubmit } = setup({ maxLen: 3 });
		await userEvent.type(input, "abcd{Enter}");
		expect(onSubmit).not.toHaveBeenCalled();
		expect(input).toHaveValue("abcd");
		await userEvent.clear(input);
		await userEvent.type(input, "/join #long{Enter}");
		expect(onSubmit).toHaveBeenCalledWith("/join #long");
	});

	it("doesn't steal keys while a dialog is open", async () => {
		const { input } = setup();
		const dialog = document.createElement("div");
		dialog.setAttribute("aria-modal", "true");
		document.body.appendChild(dialog);
		input.blur();
		await userEvent.keyboard("x");
		expect(input).toHaveValue("");
		dialog.remove();
	});

	it("hides when read-only and empty", () => {
		const { container } = setup({ readOnly: true });
		expect(container.querySelector("#composer")).toHaveClass("read-only");
	});
});

describe("Composer uploads", () => {
	function uploadClient() {
		const isupport = new irc.Isupport();
		isupport.parse(["SOJU.IM/FILEHOST=https://up.example/"]);
		return { isupport, params: {} } as unknown as Client;
	}

	it("uploads files and appends their URL", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(null, { status: 201, headers: { Location: "/f/1" } })),
		);
		const { input, container } = setup({ client: uploadClient() });
		await userEvent.type(input, "look:");
		const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
		await userEvent.upload(fileInput, new File(["x"], "cat.png", { type: "image/png" }));
		await vi.waitFor(() => expect(input).toHaveValue("look: https://up.example/f/1"));
	});

	it("reports upload failures", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
		const onError = vi.fn();
		const { container } = setup({ client: uploadClient(), onError });
		await userEvent.upload(
			container.querySelector<HTMLInputElement>('input[type="file"]')!,
			new File(["x"], "a.txt"),
		);
		await vi.waitFor(() => expect(onError).toHaveBeenCalled());
		expect(onError.mock.calls[0][0].cause.message).toBe("HTTP request failed (500)");
	});

	it("has no upload button without a file host", () => {
		setup();
		expect(screen.queryByRole("button", { name: "Upload file" })).toBeNull();
	});
});

describe("Composer replies and typing", () => {
	it("shows the reply banner and cancels with Escape", async () => {
		const onCancelReply = vi.fn();
		const { input } = setup({
			replyTo: { buffer: 1, msgid: "m1", nick: "bob", text: "hello" },
			onCancelReply,
		});
		expect(screen.getByText("bob")).toBeInTheDocument();
		expect(screen.getByText(/Replying to/)).toHaveTextContent("Replying to bob: hello");
		input.focus();
		await userEvent.keyboard("{Escape}");
		expect(onCancelReply).toHaveBeenCalledOnce();
		await userEvent.click(screen.getByRole("button", { name: "Cancel reply" }));
		expect(onCancelReply).toHaveBeenCalledTimes(2);
	});

	it("reports text changes", async () => {
		const onTextChange = vi.fn();
		const { input } = setup({ onTextChange });
		await userEvent.type(input, "ab");
		expect(onTextChange).toHaveBeenLastCalledWith("ab");
		await userEvent.keyboard("{Enter}");
		expect(onTextChange).toHaveBeenLastCalledWith("");
	});

	it("renders a status line", () => {
		setup({ status: <p>bob is typing…</p> });
		expect(screen.getByText("bob is typing…")).toBeInTheDocument();
	});
});

describe("computeAutocomplete", () => {
	const complete = (prefix: string) => ["/join", "#chan", "bob"].filter((x) => x.startsWith(prefix));

	it("completes words in the middle of text", () => {
		const ac = computeAutocomplete("hi b there", 4, null, false, complete)!;
		expect(ac.text).toBe("hi bob there");
		expect(ac.caretPos).toBe(6);
	});

	it("adds a space after commands", () => {
		expect(computeAutocomplete("/jo", 3, null, false, complete)!.text).toBe("/join ");
	});

	it("returns null without matches", () => {
		expect(computeAutocomplete("zz", 2, null, false, complete)).toBeNull();
		expect(computeAutocomplete("a ", 2, null, false, complete)).toBeNull();
	});
});
