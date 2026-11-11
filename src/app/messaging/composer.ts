/** Composer submission, commands, member actions and nickname completion. */
import * as irc from "../../lib/irc";
import * as S from "../../state";
import { SERVER_BUFFER, BufferType } from "../../state";
import commands from "../../commands";
import type AppController from "../controller";

export const composerMethods = {
	/** Returns false if the command failed right away, e.g. a missing argument. */
	executeCommand(this: AppController, s: string): boolean {
		// Extra spaces after the command name don't make empty arguments
		const [, name, rest] = /^\/(\S*)\s*(.*)$/s.exec(s) ?? ["", "", ""];
		// Repeated and trailing spaces don't make empty arguments, but are
		// kept in the text of e.g. /me and /msg
		const text = rest.trimEnd();
		const args = text === "" ? [] : text.split(/ +/);

		const cmd = commands.get(name.toLowerCase());
		if (!cmd) {
			this.showError(`Unknown command "${name}" (run "/help" to get a command list)`);
			return false;
		}

		const fail = (error: unknown) => {
			console.error(`Failed to execute command "${name}":`, error);
			this.showError(error);
		};
		try {
			const result = cmd.execute(this, args, text);
			if (result instanceof Promise) {
				result.catch(fail);
			}
			return result !== false;
		} catch (error) {
			fail(error);
			return false;
		}
	},

	/** Returns false if the text should stay in the composer, e.g. offline. */
	handleComposerSubmit(this: AppController, text: string): boolean {
		if (!text) {
			return true;
		}

		if (text.startsWith("//")) {
			text = text.slice(1);
		} else if (text.startsWith("/")) {
			// Commands take a single line. Keep the text to fix it on failure.
			return this.executeCommand(text.replace(/\n/g, " "));
		}
		// Trailing blank lines aren't worth sending
		text = text.replace(/\n+$/, "");
		if (!text) {
			return true;
		}

		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		if (!buf) {
			return false;
		}

		return this.privmsg(buf.name, text);
	},

	/** Run an action from the member list on the active channel. */
	handleMemberAction(this: AppController, nick: string, action: S.MemberAction): void {
		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		switch (action) {
			case "message":
				this.open(nick);
				this.setOpenPanel("memberList", false);
				return;
			case "whois":
				this.executeCommand(`/whois ${nick}`);
				if (buf) {
					this.switchBuffer({ server: buf.server, name: SERVER_BUFFER });
				}
				this.setOpenPanel("memberList", false);
				return;
			case "kick":
			case "ban":
			case "kickban": {
				const verb = { kick: "Kick", ban: "Ban", kickban: "Kick and ban" }[action];
				if (!window.confirm(`${verb} ${nick} from ${buf?.name ?? "the channel"}?`)) {
					return;
				}
				break;
			}
		}
		this.executeCommand(`/${action} ${nick}`);
	},

	autocomplete(this: AppController, prefix: string): string[] {
		function fromList(l: Iterable<string>, prefix: string): string[] {
			prefix = prefix.toLowerCase();
			const repl: string[] = [];
			for (const item of l) {
				if (item.toLowerCase().startsWith(prefix)) {
					repl.push(item);
				}
			}
			return repl;
		}

		if (prefix.startsWith("/")) {
			const repl = fromList(commands.keys(), prefix.slice(1));
			return repl.map((cmd) => "/" + cmd);
		}

		const client = this.getActiveClient();
		if (client?.isChannel(prefix)) {
			// Channels of other servers can't be referred to here
			const serverID = S.getActiveServerID(this.state);
			const chanNames: string[] = [];
			for (const buf of this.state.buffers.values()) {
				if (buf.type === BufferType.CHANNEL && buf.server === serverID) {
					chanNames.push(buf.name);
				}
			}
			return fromList(chanNames, prefix);
		}

		const buf = S.getBuffer(this.state, this.state.activeBuffer);
		if (!buf) {
			return [];
		}
		if (buf.type === BufferType.NICK) {
			return fromList([buf.name], prefix);
		}

		// Whoever spoke last is likely who the user is answering, and the
		// user rarely wants their own nick
		const cm = client?.cm ?? irc.CaseMapping.RFC1459;
		const rank = new Map<string, number>();
		for (let i = buf.messages.length - 1; i >= 0 && rank.size < 100; i--) {
			const msg = buf.messages[i];
			if ((msg.command === "PRIVMSG" || msg.command === "NOTICE") && msg.prefix) {
				const key = cm(msg.prefix.name);
				if (!rank.has(key)) {
					rank.set(key, rank.size);
				}
			}
		}
		const rankOf = (nick: string) => {
			if (client?.isMyNick(nick)) {
				return Number.MAX_SAFE_INTEGER;
			}
			return rank.get(cm(nick)) ?? rank.size;
		};
		// Array.prototype.sort is stable: other nicks keep their order
		return fromList(buf.members.keys(), prefix).sort((a, b) => rankOf(a) - rankOf(b));
	},
};
