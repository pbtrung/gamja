import { useState, type MouseEvent, type ReactNode } from "react";
import * as store from "../../store";
import { registerProtocolHandler } from "../../format";
import type { Context } from "./context";
import Timestamp from "./Timestamp";

/** A line of the server buffer suggesting something, with a placeholder time */
function NagLine({ showSeconds, children }: { showSeconds: boolean; children: ReactNode }) {
	return (
		<div className="logline nag">
			<Timestamp showSeconds={showSeconds} /> <span className="logline-content">{children}</span>
		</div>
	);
}

function notificationsSupported(): boolean {
	return "Notification" in globalThis;
}

export function NotificationNagger({ showSeconds }: { showSeconds: boolean }) {
	const shouldNag = () => notificationsSupported() && Notification.permission === "default";
	const [nag, setNag] = useState(shouldNag);

	if (!nag) {
		return null;
	}

	function handleClick(event: MouseEvent) {
		event.preventDefault();
		Notification.requestPermission().then(() => setNag(shouldNag()));
	}

	return (
		<NagLine showSeconds={showSeconds}>
			<a href="#" onClick={handleClick}>
				Turn on desktop notifications
			</a>{" "}
			to get notified about new messages
		</NagLine>
	);
}

export function ProtocolHandlerNagger({
	bouncerName,
	showSeconds,
}: {
	bouncerName: string | null;
	showSeconds: boolean;
}) {
	const [nag, setNag] = useState(() => !store.naggedProtocolHandler.load());

	if (!("registerProtocolHandler" in navigator) || !nag) {
		return null;
	}

	function handleClick(event: MouseEvent) {
		event.preventDefault();
		registerProtocolHandler();
		store.naggedProtocolHandler.put(true);
		setNag(false);
	}

	return (
		<NagLine showSeconds={showSeconds}>
			<a href="#" onClick={handleClick}>
				Register our protocol handler
			</a>{" "}
			to open IRC links with {bouncerName || "this bouncer"}
		</NagLine>
	);
}

export function AccountNagger({ ctx }: { ctx: Context }) {
	const { server } = ctx;
	const accDesc = server.name ? "a " + server.name + " account" : "an account on this server";

	function handleAuthClick(event: MouseEvent) {
		event.preventDefault();
		ctx.onAuthClick();
	}
	function handleRegisterClick(event: MouseEvent) {
		event.preventDefault();
		ctx.onRegisterClick();
	}

	return (
		<NagLine showSeconds={ctx.settings.secondsInTimestamps}>
			You are unauthenticated on this server,{" "}
			<a href="#" onClick={handleAuthClick}>
				login
			</a>{" "}
			{server.supportsAccountRegistration ? (
				<>
					or{" "}
					<a href="#" onClick={handleRegisterClick}>
						register
					</a>{" "}
					{accDesc}
				</>
			) : (
				<>if you have {accDesc}</>
			)}
		</NagLine>
	);
}
