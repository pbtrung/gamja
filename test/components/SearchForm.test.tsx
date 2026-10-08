import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as irc from "../../src/lib/irc";
import SearchForm from "../../src/components/forms/SearchForm";

const result = (buffer: string, line: string) => ({ buffer, message: irc.parseMessage(line) });

describe("SearchForm", () => {
	it("searches the buffer and selects a result", async () => {
		const onSearch = vi
			.fn()
			.mockResolvedValue([
				result("#c", "@msgid=1;time=2020-01-01T00:00:00.000Z :bob!u@h PRIVMSG #c :the Needle here"),
				result("#c", ":carol!u@h PRIVMSG #c :needle without id"),
			]);
		const onSelect = vi.fn();
		render(<SearchForm buffer="#c" initialQuery="needle" onSearch={onSearch} onSelect={onSelect} />);
		expect(screen.getByLabelText("In")).toHaveValue("buffer");
		await userEvent.type(screen.getByLabelText("From"), "bob");
		await userEvent.click(screen.getByRole("button", { name: "Search" }));
		expect(onSearch).toHaveBeenCalledWith({ text: "needle", in: "#c", from: "bob" });
		expect(screen.getByRole("status")).toHaveTextContent("2 messages found");
		const list = screen.getByRole("list", { name: "Search results" });
		expect(within(list).getAllByRole("button")[1]).toBeDisabled();
		expect(list.querySelector("mark")).toHaveTextContent("Needle");
		await userEvent.click(within(list).getAllByRole("button")[0]);
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ buffer: "#c" }));
	});

	it("searches everywhere and reports errors and empty results", async () => {
		const onSearch = vi.fn().mockRejectedValueOnce(new Error("Search failed")).mockResolvedValueOnce([]);
		render(<SearchForm buffer={null} onSearch={onSearch} onSelect={() => {}} />);
		expect(screen.getByLabelText("In")).toHaveValue("all");
		expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
		await userEvent.type(screen.getByRole("searchbox"), "x{Enter}");
		expect(onSearch).toHaveBeenCalledWith({ text: "x", in: null, from: null });
		expect(screen.getByRole("alert")).toHaveTextContent("Search failed");
		await userEvent.keyboard("{Enter}");
		expect(screen.getByRole("status")).toHaveTextContent("No messages found");
	});
});
