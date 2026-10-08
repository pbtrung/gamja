import { test, expect } from "./fixtures.ts";

test("reacts to, replies to and deletes messages", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#rx");
	await connect(page, "tester", { channels: ["#rx"] });
	await expect(page.locator("#buffer-header h1")).toHaveText("#rx");

	bob.privmsg("#rx", "react to me");
	const line = page.locator("#buffer .logline", { hasText: "react to me" });
	await expect(line).toBeVisible();
	const msgid = await line.getAttribute("data-msgid");

	// React
	await line.hover();
	await line.getByRole("button", { name: "Add reaction" }).click();
	await page.getByRole("menuitem", { name: "React with 🎉" }).click();
	await bob.waitFor((l) => l.includes(`+draft/react=🎉;+draft/reply=${msgid}`) && l.includes("TAGMSG #rx"));
	const chip = line.getByRole("button", { name: /^🎉 1/ });
	await expect(chip).toHaveAttribute("aria-pressed", "true");

	// Someone else reacts too
	bob.send(`@+draft/react=🎉;+draft/reply=${msgid} TAGMSG #rx`);
	await expect(line.getByRole("button", { name: "🎉 2: tester, bob" })).toBeVisible();

	// Un-react
	await line.getByRole("button", { name: /^🎉 2/ }).click();
	await expect(line.getByRole("button", { name: "🎉 1: bob" })).toHaveAttribute("aria-pressed", "false");

	// Reply
	await line.hover();
	await line.getByRole("button", { name: "Reply" }).click();
	await expect(page.getByText("Replying to")).toContainText("bob: react to me");
	await page.keyboard.type("nice!");
	await page.keyboard.press("Enter");
	await bob.waitFor((l) => l.includes(`+draft/reply=${msgid}`) && / PRIVMSG #rx :?nice!$/.test(l));
	const replyLine = page.locator("#buffer .logline", { hasText: "nice!" });
	await expect(replyLine.getByRole("button", { name: /react to me/ })).toBeVisible();
	const reply = page.locator(
		`#buffer .logline[data-msgid="${await replyLine.getAttribute("data-msgid")}"]`,
	);
	await expect(page.getByText("Replying to")).toHaveCount(0);

	// Delete our reply
	page.once("dialog", (dialog) => dialog.accept());
	await reply.hover();
	await reply.getByRole("button", { name: "Delete message" }).click();
	await expect(reply).toContainText("This message has been deleted.");
	await bob.waitFor((l) => l.includes("REDACT #rx"));
});

test("shows typing notifications both ways", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#typing");
	await connect(page, "tester", { channels: ["#typing"] });
	await expect(page.locator("#buffer-header h1")).toHaveText("#typing");

	bob.send("@+typing=active TAGMSG #typing");
	await expect(page.getByText("bob is typing…")).toBeVisible();
	bob.privmsg("#typing", "hi");
	await expect(page.getByText("bob is typing…")).toHaveCount(0);

	await page.getByRole("textbox", { name: "Type a message" }).pressSequentially("hel");
	await bob.waitFor((l) => l.includes("+typing=active") && l.includes("TAGMSG #typing"));
	await page.getByRole("textbox", { name: "Type a message" }).fill("");
	await bob.waitFor((l) => l.includes("+typing=done"));
});
