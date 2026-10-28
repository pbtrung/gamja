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
