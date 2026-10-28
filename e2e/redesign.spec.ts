import { test, expect } from "./fixtures.ts";

test("filters collapsed networks without changing their saved state", async ({ page, connect }) => {
	await connect(page, "tester", { channels: ["#alpha", "#beta"] });
	await page.getByRole("tab", { name: "FakeNet" }).click();
	const network = page.getByRole("tab", { name: "FakeNet" });
	await network.locator(".buffer-collapse").click();
	await expect(network).toHaveAttribute("aria-expanded", "false");
	await expect(page.getByRole("tab", { name: "#alpha" })).toHaveCount(0);

	const filter = page.getByRole("searchbox", { name: "Filter buffers" });
	await filter.fill("ALPHA");
	await expect(page.getByRole("tab", { name: "#alpha" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "#beta" })).toHaveCount(0);
	await filter.press("Escape");
	await expect(filter).toHaveValue("");
	await expect(network).toHaveAttribute("aria-expanded", "false");
	await expect(page.getByRole("tab", { name: "#alpha" })).toHaveCount(0);

	await filter.fill("does-not-exist");
	await expect(page.getByText("No buffer matches the filter.")).toBeVisible();
	await page.getByRole("button", { name: "Clear filter buffers" }).click();
	await expect(filter).toBeFocused();
	await filter.fill("alpha");
	await filter.press("ArrowDown");
	await expect(network).toBeFocused();
	await network.press("ArrowDown");
	await page.keyboard.press("Enter");
	await expect(page.locator("#buffer-header h1")).toHaveText("#alpha");
});

test("filters users and toggles the desktop member list", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#members");
	await connect(page, "tester", { channels: ["#members"] });
	const toggle = page.getByRole("button", { name: "Open member list" });
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	const members = page.locator("#member-list");
	const filter = members.getByRole("searchbox", { name: "Filter users" });
	await filter.fill("BOB");
	await expect(members.getByRole("link", { name: "@bob" })).toBeVisible();
	await expect(members.getByRole("link", { name: "tester", exact: true })).toHaveCount(0);
	await filter.fill("no-such-user");
	await expect(members.getByText("No user matches the filter.")).toBeVisible();
	await filter.press("Escape");
	await expect(members.getByRole("link", { name: "tester", exact: true })).toBeVisible();
	await toggle.click();
	await expect(members).toBeHidden();
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("uses drawers at tablet widths and closes them with the backdrop or Escape", async ({
	page,
	connect,
}) => {
	await page.setViewportSize({ width: 820, height: 900 });
	await connect(page, "tester", { channels: ["#tablet"] });
	const sidebar = page.locator("#buffer-list");
	const toggle = page.getByRole("button", { name: "Open buffer list" });
	await expect(sidebar).toBeHidden();
	await toggle.click();
	await expect(sidebar).toBeVisible();
	const box = (await sidebar.boundingBox())!;
	expect(box.width).toBeLessThan(820);
	await page.getByRole("button", { name: "Close side panels" }).click({ position: { x: 800, y: 400 } });
	await expect(sidebar).toBeHidden();
	await toggle.click();
	await page.getByRole("searchbox", { name: "Filter buffers" }).focus();
	await page.keyboard.press("Escape");
	await expect(sidebar).toBeHidden();
	await expect(toggle).toBeFocused();
});

test("touches the chat pane edges by default and remembers the input setting", async ({ page, connect }) => {
	await connect(page, "tester", { channels: ["#edges"] });
	const input = page.locator(".composer-box");
	for (const width of [412, 1280]) {
		await page.setViewportSize({ width, height: 800 });
		await expect(input).toHaveCSS("border-radius", "0px");
		const chatBounds = (await page.locator("#buffer").boundingBox())!;
		const inputBounds = (await input.boundingBox())!;
		expect(inputBounds.x).toBe(chatBounds.x);
		expect(inputBounds.width).toBe(chatBounds.width);
		expect(inputBounds.y + inputBounds.height).toBe(800);
	}
	await page.getByRole("button", { name: "Settings" }).click();
	const setting = page.getByRole("checkbox", { name: "Touch the edges", exact: true });
	await expect(setting).toBeChecked();
	await setting.click();
	await page.keyboard.press("Escape");
	await expect(input).toHaveCSS("border-radius", "14px");
	await connect(page, "tester", { channels: ["#edges"] });
	await expect(input).toBeVisible();
	await expect(input).toHaveCSS("border-radius", "14px");
});

test("sizes buffer text in pixels and remembers it without resizing the interface", async ({
	page,
	connect,
	bot,
}) => {
	const bob = await bot("bob");
	await bob.join("#size");
	await connect(page, "tester", { channels: ["#size"] });
	bob.privmsg("#size", "message text size");
	const text = page.locator("#buffer .logline-content", { hasText: "message text size" });
	await expect(text).toHaveCSS("font-size", "15px");
	await page.getByRole("button", { name: "Settings" }).click();
	await expect(page.getByLabel("Text size", { exact: true })).toHaveCount(0);
	await page.getByRole("tab", { name: "Messages", exact: true }).click();
	const size = page.getByRole("spinbutton", { name: "Text size", exact: true });
	await expect(size).toHaveValue("15");
	for (let pixels = 10; pixels <= 20; pixels++) {
		await size.fill(String(pixels));
		await expect(text).toHaveCSS("font-size", `${pixels}px`);
		await expect(page.locator("body")).toHaveCSS("font-size", "16px");
		await expect(page.locator("#buffer-header h1")).toHaveCSS("font-size", "16px");
		await expect(page.locator(".composer-input")).toHaveCSS("font-size", "16px");
	}
	await page.keyboard.press("Escape");
	await page.setViewportSize({ width: 412, height: 800 });
	await expect(text).toHaveCSS("font-size", "20px");
	await connect(page, "tester", { channels: ["#size"] });
	await expect(page.locator("#buffer")).toHaveCSS("font-size", "20px");
});
