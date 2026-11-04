import { test, expect } from "./fixtures.ts";

test("caps narrow nicknames by character count and wide nicknames by column width", async ({
	page,
	connect,
	bot,
	settings,
}) => {
	await settings({ layout: "columns", nickColumnWidth: 8 });
	const narrow = await bot("iiiiiiiiiiiiii");
	const wide = await bot("WWWWWWWWWWWWWW");
	await narrow.join("#width");
	await wide.join("#width");
	await connect(page, "tester", { channels: ["#width"] });
	narrow.privmsg("#width", "narrow nickname");
	wide.privmsg("#width", "wide nickname");
	for (const [message, nick, shown] of [
		["narrow nickname", narrow.nick, "iiiiiiii"],
		["wide nickname", wide.nick, "WWWWWWWW"],
	]) {
		const row = page.locator(".logline.columns", { hasText: message });
		const prefix = row.locator(".logline-prefix");
		const link = prefix.locator("a.nick");
		await expect(link).toHaveText(shown);
		await expect(link).toHaveAttribute("aria-label", nick);
		await expect(link).toHaveAttribute("title", new RegExp(nick));
		await expect(prefix).toHaveAttribute("data-truncated", "");
		await link.click();
		await expect(page.locator("#buffer-header h1")).toHaveText(nick);
		await page.getByRole("tab", { name: "#width", exact: true }).click();
	}
});
