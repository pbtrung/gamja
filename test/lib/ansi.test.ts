import { describe, expect, it } from "vitest";
import { cssColor, parse, strip } from "../../src/lib/ansi";

describe("ansi", () => {
	it("strips formatting", () => {
		expect(strip("\x02bold\x02 \x0304,12red\x03 \x04ff00ffhex\x0f \x1ditalic")).toBe(
			"bold red hex italic",
		);
		expect(strip("\x03,5 comma is text")).toBe(",5 comma is text");
	});

	it("parses styles", () => {
		expect(parse("a\x02b\x1Dc\x0Fd")).toEqual([
			{ text: "a", style: {} },
			{ text: "b", style: { bold: true } },
			{ text: "c", style: { bold: true, italic: true } },
			{ text: "d", style: {} },
		]);
	});

	it("parses colors", () => {
		expect(parse("\x034,12x\x03y")).toEqual([
			{ text: "x", style: { fg: 4, bg: 12 } },
			{ text: "y", style: { fg: undefined, bg: undefined } },
		]);
		expect(parse("\x04FF0000,00ff00z")).toEqual([{ text: "z", style: { fg: "#FF0000", bg: "#00ff00" } }]);
	});

	it("handles reverse color", () => {
		expect(parse("\x0303,04\x16x")[0].style).toMatchObject({ fg: 4, bg: 3 });
	});

	it("toggles reverse color back", () => {
		const styles = parse("a\x16b\x16c").map((seg) => seg.style);
		expect(styles[1]).toMatchObject({ fg: 0, bg: 1 });
		expect(styles[2]).toEqual({ fg: undefined, bg: undefined });

		const colored = parse("\x0303,04a\x16b\x16c").map((seg) => seg.style);
		expect(colored[2]).toEqual({ fg: 3, bg: 4 });

		// Colors changed while reversed get swapped back
		const changed = parse("a\x16\x0305b\x16c").map((seg) => seg.style);
		expect(changed[1]).toEqual({ fg: 5, bg: 1 });
		expect(changed[2]).toEqual({ fg: undefined, bg: 5 });

		// Reset ends the reverse
		const reset = parse("\x16a\x0f\x16b").map((seg) => seg.style);
		expect(reset[1]).toEqual({ fg: 0, bg: 1 });
	});

	it("resolves CSS colors", () => {
		expect(cssColor(4)).toBe("#ff0000");
		expect(cssColor("#123456")).toBe("#123456");
		expect(cssColor(undefined)).toBeUndefined();
	});
});
