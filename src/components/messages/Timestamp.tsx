import { useContext } from "react";
import { formatTime } from "../../format";
import { Clock12hContext } from "./context";

export default function Timestamp({
	date,
	url,
	showSeconds,
}: {
	date?: Date;
	url?: string | null;
	showSeconds: boolean;
}) {
	const clock12h = useContext(Clock12hContext);
	if (!date) {
		const placeholder = (showSeconds ? "--:--:--" : "--:--") + (clock12h ? " --" : "");
		return (
			<span className="timestamp" aria-hidden="true">
				{placeholder}
			</span>
		);
	}

	return (
		<a
			href={url ?? undefined}
			className="timestamp"
			title={date.toLocaleString()}
			onClick={(event) => event.preventDefault()}
		>
			<time dateTime={date.toISOString()}>{formatTime(date, showSeconds, clock12h)}</time>
		</a>
	);
}
