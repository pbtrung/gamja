import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RichText, { Linkified } from "../../src/components/RichText";

describe("RichText", () => {
	it("renders links and channels", () => {
		const onClick = vi.fn((e) => e.preventDefault());
		render(
			<p>
				<RichText text="see https://example.org and #gamja" onLinkClick={onClick} />
			</p>,
		);
		expect(screen.getByRole("link", { name: "https://example.org" })).toHaveAttribute(
			"href",
			"https://example.org",
		);
		const chan = screen.getByRole("link", { name: "#gamja" });
		expect(chan).toHaveAttribute("href", "irc:///%23gamja");
		chan.click();
		expect(onClick).toHaveBeenCalled();
	});

	it("renders IRC formatting", () => {
		const { container } = render(
			<p>
				<RichText text={"\x02bold\x02 \x0304red\x03 \x1Ditalic"} />
			</p>,
		);
		expect(container.querySelector(".fmt-bold")).toHaveTextContent("bold");
		expect(container.querySelector(".fmt-italic")).toHaveTextContent("italic");
		const red = [...container.querySelectorAll("span")].find((s) => s.textContent === "red")!;
		expect(red.style.color).toBe("rgb(255, 0, 0)");
		expect(container.textContent).toBe("bold red italic");
	});

	it("renders white, color 0", () => {
		const { container } = render(
			<p>
				<RichText text={"\x030white"} />
			</p>,
		);
		expect(container.querySelector("span")?.style.color).toBe("rgb(255, 255, 255)");
	});

	it("linkifies plain text", () => {
		render(
			<p>
				<Linkified text="x ircs://irc.libera.chat/#soju" />
			</p>,
		);
		expect(screen.getByRole("link")).toHaveAttribute("href", "ircs://irc.libera.chat/#soju");
	});
});
