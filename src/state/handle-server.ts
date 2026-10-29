/** State updates from server replies: its features, our nick and account. */

import * as irc from "../lib/irc";
import type Client from "../lib/client";
import { METADATA_KEYS, SERVER_BUFFER, type Features, type TargetMetadata } from "./model";
import { updateServer } from "./buffers";
import { updateTarget, type MessageHandler } from "./handle-common";

function computeFeatures(client: Pick<Client, "caps" | "isupport">): Features {
	const tags = client.caps.enabled.has("message-tags");
	return {
		reactions: tags && irc.isClientTagAllowed(client.isupport, "draft/react"),
		replies: tags && irc.isClientTagAllowed(client.isupport, "draft/reply"),
		typing: tags && irc.isClientTagAllowed(client.isupport, "typing"),
		redaction: client.caps.enabled.has("draft/message-redaction"),
		search: client.caps.enabled.has("soju.im/search"),
		webPush: client.caps.enabled.has("soju.im/webpush") && Boolean(client.isupport.vapid()),
		// soju's keys only apply to a network's targets
		targetMetadata:
			client.caps.enabled.has("draft/metadata-2") && Boolean(client.isupport.bouncerNetID()),
	};
}

const handleMyInfo: MessageHandler = (state, msg, serverID) => {
	// TODO: parse available modes
	const serverInfo = {
		name: msg.params[1],
		version: msg.params[2],
	};
	return updateTarget(state, serverID, SERVER_BUFFER, { serverInfo });
};

/** Apply the case mapping and features the server advertises. */
const handleISupport: MessageHandler = (state, _msg, serverID, client) => {
	const buffers = new Map(state.buffers);
	state.buffers.forEach((buf) => {
		if (buf.server !== serverID) {
			return;
		}
		const members = new irc.CaseMapMap(buf.members, client.cm);
		const pendingMembers = buf.pendingMembers && new irc.CaseMapMap(buf.pendingMembers, client.cm);
		buffers.set(buf.id, { ...buf, members, pendingMembers });
	});
	return {
		buffers,
		...updateServer(state, serverID, (server) => {
			return {
				name: client.isupport.network() ?? null,
				cm: client.cm,
				users: new irc.CaseMapMap(server.users, client.cm),
				metadata: new irc.CaseMapMap(server.metadata, client.cm),
				reliableUserAccounts: client.isupport.monitor() > 0 && client.isupport.whox(),
				statusMsg: client.isupport.statusMsg(),
				membershipModes: client.isupport.membershipModes(),
				bouncerNetID: client.isupport.bouncerNetID() ?? null,
				features: computeFeatures(client),
			};
		}),
	};
};

const handleWelcome: MessageHandler = (state, msg, serverID) => {
	return updateServer(state, serverID, { nick: msg.params[0] });
};

const handleMetadata: MessageHandler = (state, msg, serverID) => {
	// METADATA <target> <key> <visibility> [value]
	// RPL_KEYVALUE <client> <target> <key> <visibility> <value>
	const [target, key, , value] = msg.command === "METADATA" ? msg.params : msg.params.slice(1);
	const field = (Object.keys(METADATA_KEYS) as (keyof TargetMetadata)[]).find(
		(k) => METADATA_KEYS[k] === key?.toLowerCase(),
	);
	if (!target || !field) {
		return;
	}
	return updateServer(state, serverID, (server) => {
		const metadata = new irc.CaseMapMap(server.metadata);
		metadata.set(target, { ...metadata.get(target), [field]: value === "1" });
		return { metadata };
	});
};

const handleCap: MessageHandler = (state, _msg, serverID, client) => {
	return updateServer(state, serverID, {
		features: computeFeatures(client),
		supportsSASLPlain: client.supportsSASL("PLAIN"),
		supportsAccountRegistration: client.caps.enabled.has("draft/account-registration"),
		isBouncer: client.caps.enabled.has("soju.im/bouncer-networks"),
	});
};

const handleLoggedIn: MessageHandler = (state, msg, serverID) => {
	return updateServer(state, serverID, { account: msg.params[2] });
};

const handleLoggedOut: MessageHandler = (state, _msg, serverID) => {
	return updateServer(state, serverID, { account: null });
};

/** REGISTER and VERIFY (draft/account-registration) */
const handleAccountRegistration: MessageHandler = (state, msg, serverID) => {
	if (msg.params[0] !== "SUCCESS") {
		return;
	}
	return updateServer(state, serverID, { account: msg.params[1] });
};

export const serverHandlers = new Map<string, MessageHandler>([
	[irc.RPL_MYINFO, handleMyInfo],
	[irc.RPL_ISUPPORT, handleISupport],
	[irc.RPL_WELCOME, handleWelcome],
	["METADATA", handleMetadata],
	[irc.RPL_KEYVALUE, handleMetadata],
	["CAP", handleCap],
	[irc.RPL_LOGGEDIN, handleLoggedIn],
	[irc.RPL_LOGGEDOUT, handleLoggedOut],
	["REGISTER", handleAccountRegistration],
	["VERIFY", handleAccountRegistration],
]);
