import { expect, it, vi } from "vitest";
import { connectedApp } from "../helpers/app";
import { getBuffer, unreadProgress, MAX_MESSAGES, SERVER_BUFFER, Unread } from "../../src/state";
import { parseMessage } from "../../src/lib/irc";

async function history(count: number, serverLimit = 50) {
	const h = await connectedApp({ isupport: `CASEMAPPING=rfc1459 CHANTYPES=# CHATHISTORY=${serverLimit}` });
	h.recv(":me!u@h JOIN #c", ":srv MARKREAD #c timestamp=2024-01-01T00:00:00.000Z");
	const id = getBuffer(h.app.state, { name: "#c" })!.id;
	h.app.setBufferState(id, { hasInitialWho: true });
	h.app.switchBuffer(id);
	h.sent();
	const all = Array.from({ length: count }, (_, i) =>
		parseMessage(
			`@time=${new Date(Date.UTC(2024, 0, 2, 0, 0, i)).toISOString()};msgid=m${i} :bob!u@h PRIVMSG #c :message ${i}`,
		),
	);
	const fetch = vi
		.spyOn(h.app.clients.get(h.serverID)!, "fetchHistoryBefore")
		.mockImplementation(async (_target, before, limit) => {
			const max = Math.min(limit, serverLimit);
			const eligible = all.filter((m) => m.tags.time! < before.time);
			return { messages: eligible.slice(-max), more: eligible.length >= max };
		});
	return { ...h, id, fetch, buffer: () => getBuffer(h.app.state, id)! };
}

it("loads 200 then 200 then 51, keeping opening counts independent of the live read marker", async () => {
	const { app, fetch, buffer, sent } = await history(451);
	try {
		await app.fetchOlderMessages();
		expect(buffer().messages).toHaveLength(200);
		expect(fetch.mock.calls.map((c) => c[2])).toEqual([200, 150, 100, 50]);
		expect(unreadProgress(buffer())?.label).toBe("200 loaded · more available");
		expect(sent().filter((l) => l.startsWith("MARKREAD"))).toEqual([
			"MARKREAD #c timestamp=2024-01-02T00:07:30.000Z",
		]);
		await app.fetchOlderMessages();
		expect(buffer().messages).toHaveLength(400);
		expect(unreadProgress(buffer())?.label).toBe("400 loaded · more available");
		expect(sent().filter((l) => l.startsWith("MARKREAD"))).toEqual([]);
		await app.fetchOlderMessages();
		expect(buffer().messages).toHaveLength(451);
		expect(buffer().history).toBe("end");
		expect(unreadProgress(buffer())?.label).toBe("451 new · all loaded");
		expect(sent().filter((l) => l.startsWith("MARKREAD"))).toEqual([]);
		fetch.mockClear();
		await app.fetchOlderMessages();
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		app.destroy();
	}
});

it("stops at the browser buffer limit without calling it the end of history", async () => {
	const { app, fetch, buffer } = await history(MAX_MESSAGES + 500);
	try {
		for (let i = 0; i < MAX_MESSAGES / 200; i++) {
			await app.fetchOlderMessages();
		}
		expect(buffer().messages).toHaveLength(MAX_MESSAGES);
		expect(buffer().history).toBe("limited");
		expect(unreadProgress(buffer())?.label).toBe(
			`${MAX_MESSAGES.toLocaleString()} loaded · buffer limit reached`,
		);
		fetch.mockClear();
		await app.fetchOlderMessages();
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		app.destroy();
	}
});

it("honors a configured page larger than the usual buffer limit", async () => {
	const { app, fetch, buffer } = await history(4500, 1000);
	try {
		app.handleSettingsChange({ backlogSize: 4000 });
		await app.fetchOlderMessages();
		expect(buffer().messages).toHaveLength(4000);
		expect(fetch).toHaveBeenCalledTimes(4);
		expect(buffer().history).toBe("limited");
	} finally {
		app.destroy();
	}
});

it("keeps the opening boundary while live read markers advance at the bottom and hold while scrolled up", async () => {
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
	const { app, id, recv, buffer, sent } = await history(451);
	try {
		await app.fetchOlderMessages();
		const opening = buffer().prevReadReceipt;
		app.setBufferState(id, {
			gap: {
				after: { time: opening!.time },
				before: { time: buffer().messages[0].tags.time! },
				status: "idle",
			},
		});
		sent();
		recv("@time=2024-01-03T00:00:00.000Z;msgid=live :bob!u@h PRIVMSG #c :live message");
		expect(sent()).toContain("MARKREAD #c timestamp=2024-01-03T00:00:00.000Z");
		expect(buffer().prevReadReceipt).toEqual(opening);
		expect(unreadProgress(buffer())?.count).toBe(201);
		recv("@time=2024-01-03T00:00:01.000Z;msgid=mine :me!u@h PRIVMSG #c :my reply");
		expect(sent()).toContain("MARKREAD #c timestamp=2024-01-03T00:00:01.000Z");
		expect(buffer().prevReadReceipt).toEqual(opening);
		app.handleScrolledToLatest(false);
		recv("@time=2024-01-03T00:00:02.000Z;msgid=unseen :bob!u@h PRIVMSG #c :while scrolled up");
		expect(sent().filter((l) => l.startsWith("MARKREAD"))).toEqual([]);
		expect(buffer().unread).toBe(Unread.MESSAGE);
		expect(unreadProgress(buffer())?.count).toBe(203);
		app.handleScrolledToLatest(true);
		expect(sent()).toContain("MARKREAD #c timestamp=2024-01-03T00:00:02.000Z");
		expect(buffer().prevReadReceipt).toEqual(opening);
		app.switchBuffer(getBuffer(app.state, { name: SERVER_BUFFER })!.id);
		app.switchBuffer(id);
		expect(buffer().prevReadReceipt?.time).toBe("2024-01-03T00:00:02.000Z");
		expect(unreadProgress(buffer())).toBeUndefined();
	} finally {
		app.destroy();
	}
});
