/** Commands sending messages to channels and users. */

import { getActiveClient, getActiveTarget, requireArg, textAfter, type Command } from "./common";

export const away: Command = {
	name: "away",
	usage: "[message]",
	description: "Set away message",
	execute: (app, _args, text) => {
		getActiveClient(app); // Fail early when disconnected
		app.setAway(text);
	},
};

export const me: Command = {
	name: "me",
	usage: "<action>",
	description: "Send an action message to the current buffer",
	execute: (app, args, action) => {
		requireArg(args, 0, "action");
		const target = getActiveTarget(app);
		const text = `\x01ACTION ${action}\x01`;
		return app.privmsg(target, text);
	},
};

export const msg: Command = {
	name: "msg",
	usage: "<target> <message>",
	description: "Send a message to a nickname or a channel",
	execute: (app, args, text) => {
		const target = requireArg(args, 0, "target");
		requireArg(args, 1, "message");
		getActiveClient(app);
		return app.sendChatMessage("PRIVMSG", target, textAfter(text, 1));
	},
};

export const notice: Command = {
	name: "notice",
	usage: "<target> <message>",
	description: "Send a notice to a nickname or a channel",
	execute: (app, args, text) => {
		const target = requireArg(args, 0, "target");
		requireArg(args, 1, "message");
		getActiveClient(app);
		return app.sendChatMessage("NOTICE", target, textAfter(text, 1));
	},
};

export const query: Command = {
	name: "query",
	usage: "<nick> [message]",
	description: "Open a buffer to send messages to a nickname",
	execute: (app, args, text) => {
		const nick = requireArg(args, 0, "nickname");
		app.open(nick);

		if (args.length > 1) {
			return app.privmsg(nick, textAfter(text, 1));
		}
	},
};
