/** Commands about the connection and queries to the server. */

import * as irc from "../lib/irc";
import { SERVER_BUFFER } from "../state";
import { getActiveClient, markServerBufferUnread, requireArg, type Command } from "./common";

/**
 * A command sending its arguments as-is to the server, whose replies are
 * shown in the server buffer: flag it, the user is likely elsewhere.
 */
export function serverQuery(name: string, usage: string, description: string, required?: string): Command {
	return {
		name,
		usage,
		description,
		execute: (app, args) => {
			if (required) {
				requireArg(args, 0, required);
			}
			getActiveClient(app).send({ command: name.toUpperCase(), params: args });
			markServerBufferUnread(app);
		},
	};
}

export const disconnect: Command = {
	name: "disconnect",
	description: "Disconnect from the server",
	execute: (app) => {
		app.disconnect();
	},
};

export const reconnect: Command = {
	name: "reconnect",
	description: "Reconnect to the server",
	execute: (app) => {
		app.reconnect();
	},
};

export const quit: Command = {
	name: "quit",
	description: "Quit",
	execute: (app) => {
		app.close({ name: SERVER_BUFFER });
	},
};

export const nick: Command = {
	name: "nick",
	usage: "<nick>",
	description: "Change current nickname",
	execute: (app, args) => {
		const newNick = requireArg(args, 0, "nick");
		getActiveClient(app).send({ command: "NICK", params: [newNick] });
	},
};

export const setname: Command = {
	name: "setname",
	usage: "<realname>",
	description: "Change current realname",
	execute: (app, _args, newRealname) => {
		const client = getActiveClient(app);
		if (!client.caps.enabled.has("setname")) {
			throw new Error("Server doesn't support changing the realname");
		}
		client.send({ command: "SETNAME", params: [newRealname] });
	},
};

export const quote: Command = {
	name: "quote",
	usage: "<command>",
	description: "Send a raw IRC command to the server",
	execute: (app, _args, text) => {
		let msg;
		try {
			msg = irc.parseMessage(text);
		} catch (err) {
			throw new Error("Failed to parse IRC command", { cause: err });
		}
		getActiveClient(app, { registering: true }).send(msg);
	},
};

export const stats: Command = {
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
};

export const whois: Command = {
	name: "whois",
	usage: "<nick>",
	description: "Retrieve information about a user",
	execute: (app, args) => {
		const nick = requireArg(args, 0, "nick");
		getActiveClient(app).send({ command: "WHOIS", params: [nick] });
		markServerBufferUnread(app);
	},
};

export const lusers = serverQuery(
	"lusers",
	"[<mask> [<target>]]",
	"Request user statistics about the network",
);
export const motd = serverQuery("motd", "[server]", "Get the Message Of The Day");
export const who = serverQuery("who", "<mask>", "Retrieve a list of users");
export const whowas = serverQuery(
	"whowas",
	"<nick> [count]",
	"Retrieve information about an offline user",
	"nick",
);
export const list = serverQuery("list", "[filter]", "Retrieve a list of channels from a network");
