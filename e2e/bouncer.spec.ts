import { test, expect } from "./fixtures.ts";

test.use({ serverOptions: { bouncer: true } });

test("lists, adds, edits and removes bouncer networks", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#net");
	// soju requires logging in, which must happen before binding to networks
	await connect(page, "alice", { password: "secret" });

	const tabs = page.getByRole("tablist", { name: "Buffer list" });
	await expect(tabs.getByRole("tab", { name: "bouncer" })).toBeVisible();
	await expect(tabs.getByRole("tab", { name: "FakeNet" })).toBeVisible();

	// The bound connection works like a regular server
	await tabs.getByRole("tab", { name: "FakeNet" }).click();
	await page.keyboard.type("/join #net");
	await page.keyboard.press("Enter");
	await expect(page.locator("#buffer-header h1")).toHaveText("#net");
	bob.privmsg("#net", "hello through the bouncer");
	await expect(page.locator("#buffer")).toContainText("hello through the bouncer");

	// Add a network from the bouncer buffer
	await tabs.getByRole("tab", { name: "bouncer" }).click();
	await page.getByRole("button", { name: "Add network" }).first().click();
	const dialog = page.getByRole("dialog", { name: "Add network" });
	await dialog.getByLabel("Hostname").fill("irc.example.org");
	await dialog.getByRole("button", { name: "Add network" }).click();
	await expect(tabs.getByRole("tab", { name: "irc.example.org" })).toBeVisible();

	// Rename it
	await tabs.getByRole("tab", { name: "irc.example.org" }).click();
	await page.getByRole("button", { name: "Manage network" }).click();
	const edit = page.getByRole("dialog", { name: "Edit network" });
	await edit.getByText("Advanced options").click();
	await edit.getByLabel("Network name").fill("Example");
	await edit.getByRole("button", { name: "Save network" }).click();
	await expect(tabs.getByRole("tab", { name: "Example" })).toBeVisible();

	// Remove it
	await tabs.getByRole("tab", { name: "Example" }).click();
	await page.getByRole("button", { name: "Manage network" }).click();
	await page
		.getByRole("dialog", { name: "Edit network" })
		.getByRole("button", { name: "Remove network" })
		.click();
	await expect(tabs.getByRole("tab", { name: "Example" })).toHaveCount(0);
	await expect(tabs.getByRole("tab", { name: "FakeNet" })).toBeVisible();
});

test("detaches a channel without leaving it", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#detach");
	await connect(page, "alice", { password: "secret" });
	const tabs = page.getByRole("tablist", { name: "Buffer list" });
	await tabs.getByRole("tab", { name: "FakeNet" }).click();
	await page.getByRole("textbox", { name: /Type a command/ }).fill("/join #detach");
	await page.keyboard.press("Enter");
	await expect(page.locator("#buffer-header h1")).toHaveText("#detach");
	await page.getByRole("button", { name: "Detach" }).click();
	// The buffer stays, no longer joined, and no BouncerServ query opens
	await expect(page.getByRole("button", { name: "Join", exact: true })).toBeVisible();
	await expect(tabs.getByRole("tab", { name: "BouncerServ" })).toHaveCount(0);
});

test("pins and mutes buffers, synced through the bouncer", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#zzz");
	await connect(page, "alice", { password: "secret" });
	const tabs = page.getByRole("tablist", { name: "Buffer list" });
	await tabs.getByRole("tab", { name: "FakeNet" }).click();
	for (const channel of ["#aaa", "#zzz"]) {
		await page.getByRole("textbox", { name: /Type a command/ }).fill("/join " + channel);
		await page.keyboard.press("Enter");
		await expect(page.locator("#buffer-header h1")).toHaveText(channel);
		await tabs.getByRole("tab", { name: "FakeNet" }).click();
	}
	const names = () => tabs.getByRole("tab").allInnerTexts();
	expect((await names()).filter((n) => n.startsWith("#"))).toEqual(["#aaa", "#zzz"]);
	await tabs.getByRole("tab", { name: "#zzz" }).click();
	await page.getByRole("button", { name: "Pin" }).click();
	await expect(page.getByRole("button", { name: "Unpin" })).toBeVisible();
	await expect.poll(async () => (await names()).filter((n) => n.startsWith("#"))).toEqual(["#zzz", "#aaa"]);
	await page.getByRole("button", { name: "Mute" }).click();
	await expect(tabs.getByRole("tab", { name: "#zzz" }).locator("xpath=..")).toHaveClass(/muted/);
});
