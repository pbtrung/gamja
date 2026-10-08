import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as irc from "../../src/lib/irc";
import MessageList from "../../src/components/MessageList";
import {
	BufferType,
	ServerStatus,
	defaultSettings,
	type Buffer,
	type Server,
	type Settings,
} from "../../src/state";

let key = 0;
function msg(line: string, time = "2030-01-01T12:00:00.000Z", extra: Partial<irc.Message> = {}): irc.Message {
	const m = irc.parseMessage(line);
	m.tags = { time, ...m.tags };
	m.key = ++key;
	return { ...m, ...extra };
}

function server(patch: Partial<Server> = {}): Server {
	return {
		id: 1,
		name: "TestNet",
		status: ServerStatus.REGISTERED,
		cm: irc.CaseMapping.RFC1459,
		users: new irc.CaseMapMap(null, irc.CaseMapping.RFC1459),
		account: "me",
		supportsSASLPlain: false,
		supportsAccountRegistration: false,
		reliableUserAccounts: false,
		statusMsg: "@+",
		membershipModes: [
			{ mode: "o", prefix: "@" },
			{ mode: "v", prefix: "+" },
		],
		isBouncer: false,
		bouncerNetID: null,
		nick: "me",
		features: {
			reactions: true,
			replies: true,
			typing: true,
			redaction: true,
			search: false,
			webPush: false,
		},
		...patch,
	};
}

function buffer(messages: irc.Message[], patch: Partial<Buffer> = {}): Buffer {
	return {
		id: 1,
		name: "#c",
		type: BufferType.CHANNEL,
		server: 1,
		serverInfo: null,
		joined: true,
		topic: null,
		hasInitialWho: true,
		hasNames: true,
		members: new irc.CaseMapMap(null, irc.CaseMapping.RFC1459),
		messages,
		redacted: new Set(),
		reactions: new Map(),
		typing: new Map(),
		history: "unknown",
		unread: "",
		prevReadReceipt: { time: "2099-01-01T00:00:00.000Z" },
		...patch,
	};
}

function renderList(
	messages: irc.Message[],
	opts: {
		buffer?: Partial<Buffer>;
		server?: Partial<Server>;
		settings?: Partial<Settings>;
		actions?: boolean;
	} = {},
) {
	const actions = {
		myNick: "me",
		canReact: true,
		canReply: true,
		canRedact: true,
		onReact: vi.fn(),
		onReply: vi.fn(),
		onRedact: vi.fn(),
	};
	const handlers = {
		onChannelClick: vi.fn(),
		onNickClick: vi.fn(),
		onAuthClick: vi.fn(),
		onRegisterClick: vi.fn(),
		onVerifyClick: vi.fn(),
	};
	const utils = render(
		<MessageList
			buffer={buffer(messages, opts.buffer)}
			server={server(opts.server)}
			bouncerNetwork={null}
			settings={{ ...defaultSettings, ...opts.settings }}
			actions={opts.actions ? actions : undefined}
			{...handlers}
		/>,
	);
	return { ...utils, handlers, actions };
}

const lines = (container: HTMLElement) =>
	[...container.querySelectorAll(".logline-content")].map((el) => el.textContent);

describe("MessageList", () => {
	it("renders chat messages", async () => {
		const { container, handlers } = renderList([
			msg(":bob!u@h PRIVMSG #c :hello"),
			msg(":bob!u@h NOTICE #c :notice"),
			msg(":bob!u@h PRIVMSG #c :\x01ACTION waves\x01"),
			msg(":bob!u@h PRIVMSG @#c :ops"),
			msg(":srv PRIVMSG #c :hi", undefined, { isHighlight: true }),
		]);
		expect(lines(container)).toEqual([
			"<bob> hello",
			"-bob- notice",
			"* bob waves",
			"(@) <bob> ops",
			"<srv> hi",
		]);
		expect(container.querySelector(".highlight")).toHaveTextContent("hi");
		expect(container.querySelector(".me-tell")).toBeInTheDocument();
		await userEvent.click(screen.getAllByRole("link", { name: "bob" })[0]);
		expect(handlers.onNickClick).toHaveBeenCalledWith("bob");
	});

	it("renders timestamps with and without seconds", () => {
		const t = new Date(2030, 0, 1, 9, 5, 7).toISOString();
		const { container, rerender } = renderList([msg(":bob PRIVMSG #c :x", t)]);
		expect(container.querySelector(".timestamp time")).toHaveTextContent("09:05:07");
		rerender(
			<MessageList
				buffer={buffer([msg(":bob PRIVMSG #c :x", t)])}
				server={server()}
				bouncerNetwork={null}
				settings={{ ...defaultSettings, secondsInTimestamps: false }}
				onChannelClick={() => {}}
				onNickClick={() => {}}
				onAuthClick={() => {}}
				onRegisterClick={() => {}}
				onVerifyClick={() => {}}
			/>,
		);
		expect(container.querySelector(".timestamp time")).toHaveTextContent(/^09:05$/);
	});

	it("describes channel events", () => {
		const { container } = renderList(
			[
				msg(":bob!u@h KICK #c carol :spam"),
				msg(":bob!u@h TOPIC #c :new topic"),
				msg(":bob!u@h TOPIC #c :"),
				msg(":bob!u@h MODE #c +o carol"),
				msg(":bob!u@h MODE #c -v carol"),
				msg(":bob!u@h MODE #c +b *!*@x"),
				msg(":bob!u@h MODE #c +l 10"),
				msg(":bob!u@h MODE #c +m"),
				msg(":bob!u@h MODE #c +mt"),
				msg(":bob!u@h INVITE carol #c"),
				msg(":srv 324 me #c +nt"),
				msg(":srv 341 me carol #c"),
			],
			{ settings: { bufferEvents: "expand" } },
		);
		expect(lines(container)).toEqual([
			"carol was kicked by bob (spam)",
			"bob changed the topic to: new topic",
			"bob cleared the topic",
			"bob has granted operator privileges to carol",
			"bob has revoked voice privileges from carol",
			"bob has added a ban on *!*@x",
			"bob has set the channel user limit to 10",
			"bob has marked the channel as moderated",
			"bob sets mode +mt",
			"bob has invited carol to the channel",
			"Channel mode is +nt",
			"carol has been invited to the channel",
		]);
	});

	it("folds joins, parts and nick changes", () => {
		const msgs = [
			msg(":a!u@h JOIN #c"),
			msg(":b!u@h JOIN #c"),
			msg(":c!u@h PART #c"),
			msg(":d!u@h NICK d2"),
			msg(":x!u@h PRIVMSG #c :break"),
			msg(":e!u@h QUIT :bye"),
		];
		const { container } = renderList(msgs);
		expect(lines(container)).toEqual([
			"a and b have joined, c has left, d is now known as d2",
			"<x> break",
			"e has quit (bye)",
		]);
	});

	it("expands or hides events depending on settings", () => {
		const msgs = [msg(":a!u@h JOIN #c"), msg(":b!u@h JOIN #c")];
		const expanded = renderList(msgs, { settings: { bufferEvents: "expand" } });
		expect(lines(expanded.container)).toEqual(["a has joined", "b has joined"]);
		expanded.unmount();
		const hidden = renderList(msgs, { settings: { bufferEvents: "hide" } });
		expect(lines(hidden.container)).toEqual([]);
	});

	it("shows date and unread separators", () => {
		const { container } = renderList(
			[
				msg(":bob PRIVMSG #c :old", "2030-01-01T12:00:00.000Z"),
				msg(":bob PRIVMSG #c :new", "2030-01-02T12:00:00.000Z"),
			],
			{ buffer: { prevReadReceipt: { time: "2030-01-01T12:00:00.000Z" } } },
		);
		const seps = [...container.querySelectorAll("[role=separator]")].map((el) => el.className);
		expect(seps.filter((c) => c.includes("date-separator"))).toHaveLength(2);
		expect(screen.getByText("New messages")).toBeInTheDocument();
	});

	it("hides redacted message content", () => {
		const { container } = renderList([msg("@msgid=x :bob PRIVMSG #c :secret")], {
			buffer: { redacted: new Set(["x"]) },
		});
		expect(container).toHaveTextContent("This message has been deleted.");
		expect(container).not.toHaveTextContent("secret");
	});

	it("shows registration and account nags in the server buffer", async () => {
		const { handlers } = renderList([msg(":srv 001 me :Welcome")], {
			buffer: { type: BufferType.SERVER, name: "*" },
			server: { account: null, supportsSASLPlain: true, supportsAccountRegistration: true },
		});
		expect(
			screen.getByText("Connected to server, your nickname is me", { exact: false }),
		).toBeInTheDocument();
		await userEvent.click(screen.getByRole("link", { name: "login" }));
		await userEvent.click(screen.getByRole("link", { name: "register" }));
		expect(handlers.onAuthClick).toHaveBeenCalled();
		expect(handlers.onRegisterClick).toHaveBeenCalled();
	});

	it("renders account registration results", async () => {
		const { handlers } = renderList([msg(":srv REGISTER VERIFICATION_REQUIRED acct :Check your inbox")], {
			buffer: { type: BufferType.SERVER, name: "*" },
		});
		await userEvent.click(screen.getByRole("link", { name: "verify it" }));
		expect(handlers.onVerifyClick).toHaveBeenCalledWith("acct", "Check your inbox");
	});

	it("marks errors and renders unknown messages generically", () => {
		const { container } = renderList(
			[msg(":srv 433 me nick :Nickname is already in use"), msg(":srv 999 me :custom")],
			{
				buffer: { type: BufferType.SERVER, name: "*" },
			},
		);
		expect(container.querySelector(".error")).toHaveTextContent("433 me nick Nickname is already in use");
		expect(container).toHaveTextContent("999 me custom");
	});

	it("renders channel renames and standard replies", () => {
		const { container } = renderList([
			msg(":srv RENAME #old #c :merged"),
			msg(":srv FAIL CHATHISTORY MESSAGE_ERROR :Failed to fetch"),
			msg(":srv WARN * ACCOUNT_REQUIRED :Login soon"),
			msg(":srv NOTE * SOMETHING :FYI"),
		]);
		expect(lines(container)).toEqual([
			"The channel has been renamed from #old to #c (merged)",
			"CHATHISTORY: Failed to fetch",
			"Login soon",
			"FYI",
		]);
		expect(container.querySelector(".error")).toHaveTextContent("Failed to fetch");
		expect(container.querySelector(".warning")).toHaveTextContent("Login soon");
	});

	it("collapses repeated MONITOR status", () => {
		const { container } = renderList(
			[msg(":srv 731 me bob"), msg(":srv 730 me bob"), msg(":srv 730 me bob"), msg(":srv 731 me bob")],
			{ buffer: { type: BufferType.NICK, name: "bob" } },
		);
		expect(lines(container)).toEqual(["bob is online", "bob is offline"]);
	});
});

describe("MessageList interactions", () => {
	it("renders reactions and toggles them", async () => {
		const { actions } = renderList([msg("@msgid=m1 :bob!u@h PRIVMSG #c :hello")], {
			actions: true,
			buffer: {
				reactions: new Map([
					[
						"m1",
						new Map([
							["👍", ["bob", "me"]],
							["🎉", ["carol"]],
						]),
					],
				]),
			},
		});
		const mine = screen.getByRole("button", { name: "👍 2: bob, me" });
		expect(mine).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("button", { name: "🎉 1: carol" })).toHaveAttribute("aria-pressed", "false");
		await userEvent.click(mine);
		expect(actions.onReact).toHaveBeenCalledWith(
			expect.objectContaining({ tags: expect.objectContaining({ msgid: "m1" }) }),
			"👍",
		);
	});

	it("reacts, replies and deletes from the action bar", async () => {
		vi.spyOn(window, "confirm").mockReturnValue(true);
		const { actions } = renderList(
			[msg("@msgid=m1 :bob!u@h PRIVMSG #c :hello"), msg("@msgid=m2 :me!u@h PRIVMSG #c :mine")],
			{ actions: true },
		);
		const toolbars = screen.getAllByRole("toolbar", { name: "Message actions" });
		expect(toolbars).toHaveLength(2);
		// Only our own messages can be deleted
		expect(within(toolbars[0]).queryByRole("button", { name: "Delete message" })).toBeNull();

		await userEvent.click(within(toolbars[0]).getByRole("button", { name: "Add reaction" }));
		await userEvent.click(screen.getByRole("menuitem", { name: "React with 🎉" }));
		expect(actions.onReact).toHaveBeenCalledWith(expect.anything(), "🎉");
		expect(screen.queryByRole("menu")).toBeNull();

		await userEvent.click(within(toolbars[0]).getByRole("button", { name: "Reply" }));
		expect(actions.onReply).toHaveBeenCalled();

		await userEvent.click(within(toolbars[1]).getByRole("button", { name: "Delete message" }));
		expect(actions.onRedact).toHaveBeenCalledWith(expect.objectContaining({ params: ["#c", "mine"] }));
	});

	it("closes the reaction picker with Escape", async () => {
		renderList([msg("@msgid=m1 :bob!u@h PRIVMSG #c :hello")], { actions: true });
		await userEvent.click(screen.getByRole("button", { name: "Add reaction" }));
		expect(screen.getByRole("menu")).toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
		expect(screen.queryByRole("menu")).toBeNull();
	});

	it("has no actions without msgid or when disabled", () => {
		renderList([msg(":bob!u@h PRIVMSG #c :no id")], { actions: true });
		expect(screen.queryByRole("toolbar")).toBeNull();
	});

	it("quotes the message being replied to", async () => {
		const { container } = renderList([
			msg("@msgid=m1 :bob!u@h PRIVMSG #c :original text"),
			msg("@msgid=m2;+draft/reply=m1 :carol!u@h PRIVMSG #c :a reply"),
			msg("@msgid=m3;+draft/reply=gone :carol!u@h PRIVMSG #c :old reply"),
		]);
		const quote = screen.getByRole("button", { name: /original text/ });
		expect(quote).toHaveTextContent("bob");
		const target = container.querySelector('[data-msgid="m1"]')!;
		await userEvent.click(quote);
		expect(target).toHaveClass("flash");
		expect(screen.getByText("Reply to an earlier message")).toBeInTheDocument();
	});
});

describe("history status", () => {
	it("shows loading and beginning of history", () => {
		const { unmount } = renderList([], { buffer: { history: "loading" } });
		expect(screen.getByRole("status")).toHaveTextContent("Loading older messages…");
		unmount();
		renderList([], { buffer: { history: "end" } });
		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.getByText(/This is the beginning of/)).toHaveTextContent("This is the beginning of #c");
	});
});

it("offers to retry failed history fetches", async () => {
	const onRetryHistory = vi.fn();
	render(
		<MessageList
			buffer={buffer([], { history: "error" })}
			server={server()}
			bouncerNetwork={null}
			settings={defaultSettings}
			onChannelClick={() => {}}
			onNickClick={() => {}}
			onAuthClick={() => {}}
			onRegisterClick={() => {}}
			onVerifyClick={() => {}}
			onRetryHistory={onRetryHistory}
		/>,
	);
	expect(screen.getByRole("alert")).toHaveTextContent("Failed to load older messages.");
	await userEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(onRetryHistory).toHaveBeenCalled();
});
