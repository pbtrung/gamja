import { useEffect, useState } from "react";
import { BufferType, getServerName, type Buffer, type BouncerNetwork, type Server } from "../state";
import TypingIndicator from "./TypingIndicator";

/** A compact, single-line buffer status strip, like WeeChat's status bar. */
export default function ComposerStatus({
	buffer,
	server,
	bouncerNetwork,
	showTyping,
}: {
	buffer: Buffer;
	server: Server;
	bouncerNetwork: BouncerNetwork | null;
	showTyping: boolean;
}) {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const id = setInterval(() => setNow(new Date()), 1000);
		return () => clearInterval(id);
	}, []);
	const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
	const network = getServerName(server, bouncerNetwork);
	const target = buffer.type === BufferType.SERVER ? network : buffer.name;

	return (
		<div className="composer-status" role="group" aria-label="Buffer status">
			<span className="composer-status-time">[{time}]</span>
			{buffer.type !== BufferType.SERVER && (
				<span className="composer-status-network" title={network}>
					[irc/{network}]
				</span>
			)}
			<span className="composer-status-target" title={target}>
				{target}
			</span>
			{buffer.type === BufferType.CHANNEL && buffer.hasNames && (
				<span className="composer-status-members" title={`${buffer.members.size} members`}>
					{"{"}
					{buffer.members.size}
					{"}"}
				</span>
			)}
			{showTyping && <TypingIndicator buffer={buffer} />}
		</div>
	);
}
