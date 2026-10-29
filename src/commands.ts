// The slash commands, by name. They're defined by topic in src/commands/.
import * as buffers from "./commands/buffers";
import * as channel from "./commands/channel";
import * as messaging from "./commands/messaging";
import * as server from "./commands/server";
import type { Command } from "./commands/common";

// In the order of the help menu
const commandList: Command[] = [
	messaging.away,
	channel.ban,
	buffers.block,
	buffers.buffer,
	buffers.close,
	channel.deop,
	channel.detach,
	channel.devoice,
	server.disconnect,
	buffers.help,
	channel.invite,
	{ ...channel.join, name: "j" },
	channel.join,
	channel.kick,
	channel.kickban,
	server.lusers,
	messaging.me,
	channel.mode,
	server.motd,
	messaging.msg,
	buffers.mute,
	server.nick,
	messaging.notice,
	channel.op,
	channel.part,
	buffers.pin,
	messaging.query,
	channel.quiet,
	server.quit,
	server.quote,
	server.reconnect,
	buffers.search,
	server.setname,
	server.stats,
	channel.topic,
	buffers.unblock,
	channel.unban,
	buffers.unmute,
	buffers.unpin,
	channel.unquiet,
	channel.voice,
	server.who,
	server.whois,
	server.whowas,
	server.list,
];

const commands = new Map(commandList.map((cmd) => [cmd.name, cmd]));
export default commands;
