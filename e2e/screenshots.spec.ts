import { test } from "./fixtures.ts";

// Not a real test: renders screenshots of the main screens for visual review.
// Run with SCREENSHOTS=dir npx playwright test screenshots
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=<dir> to render screenshots");

for (const scheme of ["light", "dark"] as const) {
	test(`screenshots (${scheme})`, async ({ page, connect, bot }) => {
		await page.emulateMedia({ colorScheme: scheme });
		await page.setViewportSize({ width: 1280, height: 760 });
		const dir = process.env.SCREENSHOTS!;
		await page.goto("/?server=ws://invalid");
		await page.screenshot({ path: `${dir}/connect-${scheme}.png` });

		const bob = await bot("bob");
		const carol = await bot("carol");
		await bob.join("#gamja");
		await carol.join("#gamja");
		bob.send("TOPIC #gamja :Welcome to #gamja — the \x02modern\x02 IRC web client https://example.org");
		await connect(page, "tester", { channels: ["#gamja", "#other"] });
		await page.getByRole("tab", { name: "#gamja" }).click();
		bob.privmsg("#gamja", "hi everyone!");
		carol.privmsg("#gamja", "hey bob, check https://soju.im");
		bob.privmsg("#gamja", "tester: what do you think of the new UI?");
		carol.send("PRIVMSG #gamja :\x01ACTION waves\x01");
		await page.waitForTimeout(300);
		await page.getByRole("textbox", { name: "Type a message" }).fill("Looks great!");
		await page.screenshot({ path: `${dir}/chat-${scheme}.png` });
	});
}
