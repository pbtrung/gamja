import { test, expect } from "./fixtures.ts";

// Messages carry the server's time: an hour ahead of ours, the latest ones
// are in our future
test.use({ serverOptions: { clockSkew: 60 * 60 * 1000 } });

test("loads history from a server whose clock is ahead", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#skew");
	bob.privmsg("#skew", "said before you joined");
	await bob.waitFor((l) => l.includes("PRIVMSG #skew :said before you joined"));

	await connect(page, "tester", { channels: ["#skew"] });
	await expect(page.locator("#buffer-header h1")).toHaveText("#skew");
	await expect(page.locator("#buffer")).toContainText("said before you joined");
});

test("fetches messages missed while disconnected from a server whose clock is ahead", async ({
	page,
	connect,
	bot,
	ircd,
}) => {
	const bob = await bot("bob");
	await connect(page, "tester");
	bob.privmsg("tester", "hi there");
	const query = page.getByRole("tab", { name: "bob" });
	await query.click();
	await expect(page.locator("#buffer")).toContainText("hi there");

	// Drop the connection, and get a message meanwhile
	await page.getByRole("tab", { name: "FakeNet" }).click();
	for (const c of ircd.conns) {
		if (c.nick === "tester") {
			c.ws.terminate();
		}
	}
	const reconnect = page.getByRole("button", { name: "Reconnect" });
	await expect(reconnect).toBeVisible();
	ircd.recordMissedMessage("bob", "tester", "said while you were away");

	await reconnect.click();
	await expect(page.locator("#buffer")).toContainText("Connected to server", { timeout: 10000 });
	await query.click();
	await expect(page.locator("#buffer")).toContainText("said while you were away");
});
