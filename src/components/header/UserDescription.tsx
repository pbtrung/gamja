import type { ReactNode } from "react";
import { meaningfulRealname } from "../../format";
import type { Buffer, Server, User } from "../../state";

const UserStatus = {
	HERE: "here",
	GONE: "gone",
	OFFLINE: "offline",
} as const;
type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

const statusText: Record<UserStatus, string> = {
	here: "User is online",
	gone: "User is away",
	offline: "User is offline",
};

function NickStatus({ status }: { status: UserStatus }) {
	return (
		<span
			className={`status status-${status}`}
			title={statusText[status]}
			role="img"
			aria-label={statusText[status]}
		/>
	);
}

/**
 * The description of a user's buffer: whether they're here, their real name
 * and what's known about them.
 */
export default function UserDescription({
	user,
	buffer,
	server,
}: {
	user: User;
	buffer: Buffer;
	server: Server;
}) {
	let status: UserStatus = UserStatus.HERE;
	if (user.offline) {
		status = UserStatus.OFFLINE;
	} else if (user.away) {
		status = UserStatus.GONE;
	}

	const realname = meaningfulRealname(user, buffer.name) ?? buffer.name;

	const details: ReactNode[] = [];
	if (user.username && user.hostname) {
		details.push(`${user.username}@${user.hostname}`);
	}
	if (user.account) {
		const desc = `This user is verified and has logged in to the server with the account ${user.account}.`;
		const item = user.account === buffer.name ? "authenticated" : `authenticated as ${user.account}`;
		details.push(
			<abbr key="account" title={desc}>
				{item}
			</abbr>,
		);
	} else if (server.reliableUserAccounts) {
		// If the server supports MONITOR and WHOX, we can faithfully
		// keep user.account up-to-date for user queries
		details.push(
			<abbr key="account" title="This user has not been verified and is not logged in.">
				unauthenticated
			</abbr>,
		);
	}
	if (user.operator) {
		details.push(
			<abbr key="oper" title="This user is a server operator, they have administrator privileges.">
				server operator
			</abbr>,
		);
	}
	if (user.bot) {
		details.push(
			<abbr key="bot" title="This user is an automated bot.">
				bot
			</abbr>,
		);
	}

	return (
		<>
			<NickStatus status={status} /> {realname}
			{details.length > 0 && <> ({details.flatMap((d, i) => (i === 0 ? [d] : [", ", d]))})</>}
		</>
	);
}
