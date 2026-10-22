import { useState, type MouseEvent } from "react";
import * as store from "../../store";
import { registerProtocolHandler } from "../../format";
import type { Context } from "./context";
import Timestamp from "./Timestamp";

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
		<div className="logline nag">
			<Timestamp showSeconds={showSeconds} />{" "}
			<span className="logline-content">
				<a href="#" onClick={handleClick}>
					Turn on desktop notifications
				</a>{" "}
				to get notified about new messages
			</span>
		</div>
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
		<div className="logline nag">
			<Timestamp showSeconds={showSeconds} />{" "}
			<span className="logline-content">
				<a href="#" onClick={handleClick}>
					Register our protocol handler
				</a>{" "}
				to open IRC links with {bouncerName || "this bouncer"}
			</span>
		</div>
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
		<div className="logline nag">
			<Timestamp showSeconds={ctx.settings.secondsInTimestamps} />{" "}
			<span className="logline-content">
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
			</span>
		</div>
	);
}
