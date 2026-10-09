import * as irc from "./lib/irc";
import type Client from "./lib/client";
import { SERVER_BUFFER, BufferType, Unread, getBuffer, unionUnread, type TargetMetadata } from "./state";
import type AppController from "./app/controller";

export interface Command {
	name: string;
	usage?: string;
	description: string;
	execute: (app: AppController, args: string[]) => void | Promise<void>;
}

function getActiveClient(app: AppController): Client {
	const client = app.getActiveClient();
	if (!client) {
		throw new Error("Not connected to server");
	}
	return client;
}

function getActiveBuffer(app: AppController) {
	const buf = getBuffer(app.state, app.state.activeBuffer);
	if (!buf) {
		throw new Error("Not in a buffer");
	}
	return buf;
}

function getActiveTarget(app: AppController): string {
	return getActiveBuffer(app).name;
}

function getActiveChannel(app: AppController): string {
	const buf = getBuffer(app.state, app.state.activeBuffer);
	if (!buf || buf.type !== BufferType.CHANNEL) {
		throw new Error("Not in a channel");
	}
	return buf.name;
}

function requireArg(args: string[], i: number, what: string): string {
	const v = args[i];
	if (!v) {
		throw new Error("Missing " + what);
	}
	return v;
}

async function setUserHostMode(app: AppController, args: string[], mode: string): Promise<void> {
	const nick = requireArg(args, 0, "nick");
	const activeChannel = getActiveChannel(app);
	const client = getActiveClient(app);
	const whois = await client.whois(nick);
	const info = whois[irc.RPL_WHOISUSER]?.params;
	if (!info) {
		throw new Error("Failed to get user host for " + nick);
	}
	const user = info[2];
	const host = info[3];
	const masks = [`*!${user}@${host}`];
	// Also match the account, which survives host changes
	const account = whois[irc.RPL_WHOISACCOUNT]?.params[2];
	const accountMask = account ? client.isupport.accountExtban(account) : null;
	if (accountMask) {
		masks.push(accountMask);
	}
	client.send({
		command: "MODE",
		params: [activeChannel, mode[0] + mode.slice(1).repeat(masks.length), ...masks],
	});
}

function markServerBufferUnread(app: AppController): void {
	const activeBuffer = getBuffer(app.state, app.state.activeBuffer);
	if (!activeBuffer || activeBuffer.type === BufferType.SERVER) {
		return;
	}
	app.setBufferState({ server: activeBuffer.server }, (buf) => {
		return { unread: unionUnread(buf.unread, Unread.MESSAGE) };
	});
}

const join: Command = {
	name: "join",
	usage: "<name> [password]",
	description: "Join a channel",
	execute: (app, args) => {
		let channel = requireArg(args, 0, "channel name");
		const client = getActiveClient(app);
		const chanTypes = client.isupport.chanTypes();
		if (!chanTypes) {
			// e.g. the soju bouncer connection itself
			throw new Error("Channels can't be joined here, switch to a network first");
		}
		if (!client.isChannel(channel)) {
			// "/join foo" means "#foo", not a query with foo
			channel = chanTypes[0] + channel;
		}
		if (args.length > 1) {
			app.open(channel, null, args[1]);
		} else {
			app.open(channel);
		}
	},
};

const detach: Command = {
	name: "detach",
	usage: "[channel]",
	description: "Hide a channel without leaving it (soju), join it again to come back",
	execute: async (app, args) => {
		const channel = args[0] ?? getActiveChannel(app);
		const buf = getBuffer(app.state, { server: getActiveBuffer(app).server, name: channel });
		if (!buf) {
			throw new Error("Not in channel " + channel);
		}
		await app.detachChannel(buf.id);
	},
};

/** /pin, /mute, /block and their opposites (soju metadata) */
function metadataCommand(
	name: string,
	field: keyof TargetMetadata,
	value: boolean,
	usage: string,
	description: string,
): Command {
	return {
		name,
		usage,
		description,
		execute: (app, args) => {
			const buf = getActiveBuffer(app);
			// Blocking needs a nick, the others default to the current buffer
			const target = field === "blocked" ? requireArg(args, 0, "nick") : (args[0] ?? buf.name);
			if (target === SERVER_BUFFER) {
				throw new Error("Not in a channel or conversation");
			}
			app.setTargetMetadata(buf.server, target, field, value);
		},
	};
}

const kick: Command = {
	name: "kick",
	usage: "<nick> [comment]",
	description: "Remove a user from the channel",
	execute: (app, args) => {
		const nick = requireArg(args, 0, "nick");
		const activeChannel = getActiveChannel(app);
		const params = [activeChannel, nick];
		if (args.length > 1) {
			params.push(args.slice(1).join(" "));
		}
		getActiveClient(app).send({ command: "KICK", params });
	},
};

const ban: Command = {
	name: "ban",
	usage: "[nick]",
	description: "Ban a user from the channel, or display the current ban list",
	execute: (app, args) => {
		if (args.length === 0) {
			const activeChannel = getActiveChannel(app);
			getActiveClient(app).send({
				command: "MODE",
				params: [activeChannel, "+b"],
			});
		} else {
			return setUserHostMode(app, args, "+b");
		}
	},
};

function givemode(app: AppController, args: string[], mode: string): void {
	// TODO: Handle several users at once
	const nick = requireArg(args, 0, "nick");
	const activeChannel = getActiveChannel(app);
	getActiveClient(app).send({
		command: "MODE",
		params: [activeChannel, mode, nick],
	});
}

const commandList: Command[] = [
	{
		name: "away",
		usage: "[message]",
		description: "Set away message",
		execute: (app, args) => {
			getActiveClient(app).setAway(args.join(" "));
		},
	},
	ban,
	metadataCommand("block", "blocked", true, "<nick>", "Hide messages from a user (soju)"),
	{
		name: "buffer",
		usage: "<name>",
		description: "Switch to a buffer",
		execute: (app, args) => {
			const name = requireArg(args, 0, "buffer name");
			for (const buf of app.state.buffers.values()) {
				if (buf.name === name) {
					app.switchBuffer(buf.id);
					return;
				}
			}
			throw new Error("Unknown buffer");
		},
	},
	{
		name: "close",
		description: "Close the current buffer",
		execute: (app) => {
			const activeBuffer = getBuffer(app.state, app.state.activeBuffer);
			if (!activeBuffer || activeBuffer.type === BufferType.SERVER) {
				throw new Error("Not in a user or channel buffer");
			}
			app.close(activeBuffer.id);
		},
	},
	{
		name: "deop",
		usage: "<nick>",
		description: "Remove operator status for a user on this channel",
		execute: (app, args) => givemode(app, args, "-o"),
	},
	detach,
	{
		name: "devoice",
		usage: "<nick>",
		description: "Remove voiced status for a user on this channel",
		execute: (app, args) => givemode(app, args, "-v"),
	},
	{
		name: "disconnect",
		description: "Disconnect from the server",
		execute: (app) => {
			app.disconnect();
		},
	},
	{
		name: "help",
		description: "Show help menu",
		execute: (app) => {
			app.openHelp();
		},
	},
	{
		name: "invite",
		usage: "<nick>",
		description: "Invite a user to the channel",
		execute: (app, args) => {
			const nick = requireArg(args, 0, "nick");
			const activeChannel = getActiveChannel(app);
			getActiveClient(app).send({
				command: "INVITE",
				params: [nick, activeChannel],
			});
		},
	},
	{ ...join, name: "j" },
	join,
	kick,
	{
		name: "kickban",
		usage: "<target>",
		description: "Ban a user and removes them from the channel",
		execute: async (app, args) => {
			requireArg(args, 0, "nick");
			// Ban first: if looking up the user's host fails, don't kick either
			await ban.execute(app, args);
			kick.execute(app, args);
		},
	},
	{
		name: "lusers",
		usage: "[<mask> [<target>]]",
		description: "Request user statistics about the network",
		execute: (app, args) => {
			getActiveClient(app).send({ command: "LUSERS", params: args });
			markServerBufferUnread(app);
		},
	},
	{
		name: "me",
		usage: "<action>",
		description: "Send an action message to the current buffer",
		execute: (app, args) => {
			const action = args.join(" ");
			const target = getActiveTarget(app);
			const text = `\x01ACTION ${action}\x01`;
			app.privmsg(target, text);
		},
	},
	{
		name: "mode",
		usage: "[target] [modes] [mode args...]",
		description: "Query or change a channel or user mode",
		execute: (app, args) => {
			const target = args[0];
			if (!target || target.startsWith("+") || target.startsWith("-")) {
				const activeChannel = getActiveChannel(app);
				args = [activeChannel, ...args];
			}
			getActiveClient(app).send({ command: "MODE", params: args });
		},
	},
	{
		name: "motd",
		usage: "[server]",
		description: "Get the Message Of The Day",
		execute: (app, args) => {
			getActiveClient(app).send({ command: "MOTD", params: args });
			markServerBufferUnread(app);
		},
	},
	{
		name: "msg",
		usage: "<target> <message>",
		description: "Send a message to a nickname or a channel",
		execute: (app, args) => {
			const target = requireArg(args, 0, "target");
			requireArg(args, 1, "message");
			getActiveClient(app);
			app.sendChatMessage("PRIVMSG", target, args.slice(1).join(" "));
		},
	},
	metadataCommand("mute", "muted", true, "[target]", "Silence a buffer's notifications (soju)"),
	{
		name: "nick",
		usage: "<nick>",
		description: "Change current nickname",
		execute: (app, args) => {
			const newNick = requireArg(args, 0, "nick");
			getActiveClient(app).send({ command: "NICK", params: [newNick] });
		},
	},
	{
		name: "notice",
		usage: "<target> <message>",
		description: "Send a notice to a nickname or a channel",
		execute: (app, args) => {
			const target = requireArg(args, 0, "target");
			requireArg(args, 1, "message");
			getActiveClient(app);
			app.sendChatMessage("NOTICE", target, args.slice(1).join(" "));
		},
	},
	{
		name: "op",
		usage: "<nick>",
		description: "Give a user operator status on this channel",
		execute: (app, args) => givemode(app, args, "+o"),
	},
	{
		name: "part",
		usage: "[reason]",
		description: "Leave a channel",
		execute: (app, args) => {
			const reason = args.join(" ");
			const activeChannel = getActiveChannel(app);
			const params = [activeChannel];
			if (reason) {
				params.push(reason);
			}
			getActiveClient(app).send({ command: "PART", params });
		},
	},
	metadataCommand("pin", "pinned", true, "[target]", "Pin a buffer to the top of the list (soju)"),
	{
		name: "query",
		usage: "<nick> [message]",
		description: "Open a buffer to send messages to a nickname",
		execute: (app, args) => {
			const nick = requireArg(args, 0, "nickname");
			app.open(nick);

			if (args.length > 1) {
				const text = args.slice(1).join(" ");
				app.privmsg(nick, text);
			}
		},
	},
	{
		name: "quiet",
		usage: "[nick]",
		description: "Quiet a user in the channel, or display the current quiet list",
		execute: (app, args) => {
			if (args.length === 0) {
				getActiveClient(app).send({
					command: "MODE",
					params: [getActiveChannel(app), "+q"],
				});
			} else {
				return setUserHostMode(app, args, "+q");
			}
		},
	},
	{
		name: "quit",
		description: "Quit",
		execute: (app) => {
			app.close({ name: SERVER_BUFFER });
		},
	},
	{
		name: "quote",
		usage: "<command>",
		description: "Send a raw IRC command to the server",
		execute: (app, args) => {
			let msg;
			try {
				msg = irc.parseMessage(args.join(" "));
			} catch (err) {
				throw new Error("Failed to parse IRC command", { cause: err });
			}
			getActiveClient(app).send(msg);
		},
	},
	{
		name: "reconnect",
		description: "Reconnect to the server",
		execute: (app) => {
			app.reconnect();
		},
	},
	{
		name: "search",
		usage: "[text]",
		description: "Search messages in the current buffer",
		execute: (app, args) => {
			app.openSearch("buffer", args.join(" ") || undefined);
		},
	},
	{
		name: "setname",
		usage: "<realname>",
		description: "Change current realname",
		execute: (app, args) => {
			const newRealname = args.join(" ");
			const client = getActiveClient(app);
			if (!client.caps.enabled.has("setname")) {
				throw new Error("Server doesn't support changing the realname");
			}
			client.send({ command: "SETNAME", params: [newRealname] });
		},
	},
	{
		name: "stats",
		usage: "<query> [server]",
		description: "Request server statistics",
		execute: (app, args) => {
			const query = requireArg(args, 0, "query");
			const params = [query];
			if (args.length > 1) {
				params.push(args.slice(1).join(" "));
			}
			getActiveClient(app).send({ command: "STATS", params });
			markServerBufferUnread(app);
		},
	},
	{
		name: "topic",
		usage: "<topic>",
		description: "Change the topic of the current channel",
		execute: (app, args) => {
			const activeChannel = getActiveChannel(app);
			const params = [activeChannel];
			if (args.length > 0) {
				params.push(args.join(" "));
			}
			getActiveClient(app).send({ command: "TOPIC", params });
		},
	},
	metadataCommand("unblock", "blocked", false, "<nick>", "Show messages from a blocked user again (soju)"),
	{
		name: "unban",
		usage: "<nick>",
		description: "Remove a user from the ban list",
		execute: (app, args) => setUserHostMode(app, args, "-b"),
	},
	metadataCommand("unmute", "muted", false, "[target]", "Restore a buffer's notifications (soju)"),
	metadataCommand("unpin", "pinned", false, "[target]", "Unpin a buffer (soju)"),
	{
		name: "unquiet",
		usage: "<nick>",
		description: "Remove a user from the quiet list",
		execute: (app, args) => setUserHostMode(app, args, "-q"),
	},
	{
		name: "voice",
		usage: "<nick>",
		description: "Give a user voiced status on this channel",
		execute: (app, args) => givemode(app, args, "+v"),
	},
	{
		name: "who",
		usage: "<mask>",
		description: "Retrieve a list of users",
		execute: (app, args) => {
			getActiveClient(app).send({ command: "WHO", params: args });
			markServerBufferUnread(app);
		},
	},
	{
		name: "whois",
		usage: "<nick>",
		description: "Retrieve information about a user",
		execute: (app, args) => {
			const nick = requireArg(args, 0, "nick");
			getActiveClient(app).send({ command: "WHOIS", params: [nick] });
			markServerBufferUnread(app);
		},
	},
	{
		name: "whowas",
		usage: "<nick> [count]",
		description: "Retrieve information about an offline user",
		execute: (app, args) => {
			requireArg(args, 0, "nick");
			getActiveClient(app).send({ command: "WHOWAS", params: args });
			markServerBufferUnread(app);
		},
	},
	{
		name: "list",
		usage: "[filter]",
		description: "Retrieve a list of channels from a network",
		execute: (app, args) => {
			getActiveClient(app).send({ command: "LIST", params: args });
			markServerBufferUnread(app);
		},
	},
];

const commands = new Map(commandList.map((cmd) => [cmd.name, cmd]));
export default commands;
