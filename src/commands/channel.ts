/** Commands joining channels and managing them: topic, modes, bans... */

import * as irc from "../lib/irc";
import { ClientStatus } from "../lib/client";
import type Client from "../lib/client";
import { getBuffer } from "../state";
import type AppController from "../app/controller";
import {
	getActiveBuffer,
	getActiveChannel,
	getActiveClient,
	requireArg,
	textAfter,
	type Command,
} from "./common";

/**
 * Set a mode on the host of a user in the active channel. Returns the client
 * and the channel it was set in: the user may switch buffers during WHOIS.
 */
async function setUserHostMode(
	app: AppController,
	args: string[],
	mode: string,
): Promise<{ client: Client; channel: string }> {
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
	return { client, channel: activeChannel };
}

function sendKick(client: Client, channel: string, args: string[], text: string): void {
	const params = [channel, requireArg(args, 0, "nick")];
	if (args.length > 1) {
		params.push(textAfter(text, 1));
	}
	client.send({ command: "KICK", params });
}

function givemode(app: AppController, args: string[], mode: string): void {
	// TODO: Handle several users at once
	const nick = requireArg(args, 0, "nick");
	const activeChannel = getActiveChannel(app);
	getActiveClient(app).send({
		command: "MODE",
		params: [activeChannel, mode, nick],
	});
}

/** /op, /voice and their opposites */
function givemodeCommand(name: string, mode: string, description: string): Command {
	return {
		name,
		usage: "<nick>",
		description,
		execute: (app, args) => givemode(app, args, mode),
	};
}

export const join: Command = {
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

export const detach: Command = {
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

export const part: Command = {
	name: "part",
	usage: "[reason]",
	description: "Leave a channel",
	execute: (app, _args, reason) => {
		const activeChannel = getActiveChannel(app);
		const params = [activeChannel];
		if (reason) {
			params.push(reason);
		}
		getActiveClient(app).send({ command: "PART", params });
	},
};

export const topic: Command = {
	name: "topic",
	usage: "<topic>",
	description: "Change the topic of the current channel",
	execute: (app, _args, topic) => {
		const activeChannel = getActiveChannel(app);
		const params = [activeChannel];
		if (topic) {
			params.push(topic);
		}
		getActiveClient(app).send({ command: "TOPIC", params });
	},
};

export const invite: Command = {
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
};

export const mode: Command = {
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
};

export const kick: Command = {
	name: "kick",
	usage: "<nick> [comment]",
	description: "Remove a user from the channel",
	execute: (app, args, text) => {
		sendKick(getActiveClient(app), getActiveChannel(app), args, text);
	},
};

export const kickban: Command = {
	name: "kickban",
	usage: "<target>",
	description: "Ban a user and removes them from the channel",
	execute: async (app, args, text) => {
		requireArg(args, 0, "nick");
		// Ban first: if looking up the user's host fails, don't kick either.
		// Kick from where the ban went, not from the buffer active now.
		const { client, channel } = await setUserHostMode(app, args, "+b");
		if (client.status !== ClientStatus.REGISTERED) {
			throw new Error("Disconnected before kicking " + args[0]);
		}
		sendKick(client, channel, args, text);
	},
};

export const ban: Command = {
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
			return setUserHostMode(app, args, "+b").then(() => {});
		}
	},
};

export const unban: Command = {
	name: "unban",
	usage: "<nick>",
	description: "Remove a user from the ban list",
	execute: (app, args) => setUserHostMode(app, args, "-b").then(() => {}),
};

export const quiet: Command = {
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
			return setUserHostMode(app, args, "+q").then(() => {});
		}
	},
};

export const unquiet: Command = {
	name: "unquiet",
	usage: "<nick>",
	description: "Remove a user from the quiet list",
	execute: (app, args) => setUserHostMode(app, args, "-q").then(() => {}),
};

export const op = givemodeCommand("op", "+o", "Give a user operator status on this channel");
export const deop = givemodeCommand("deop", "-o", "Remove operator status for a user on this channel");
export const voice = givemodeCommand("voice", "+v", "Give a user voiced status on this channel");
export const devoice = givemodeCommand("devoice", "-v", "Remove voiced status for a user on this channel");
