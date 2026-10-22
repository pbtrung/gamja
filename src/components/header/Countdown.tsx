import { useEffect, useState } from "react";

function formatDuration(sec: number): string {
	return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

/** Seconds left until a date, updated every second */
export default function Countdown({ to }: { to: number }) {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, []);
	return <>{formatDuration(Math.max(0, Math.ceil((to - now) / 1000)))}</>;
}
