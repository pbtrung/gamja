import * as irc from "../lib/irc";

export default function Membership({ value }: { value?: string | null }) {
	if (!value) {
		return null;
	}

	const name = irc.STD_MEMBERSHIP_NAMES[value[0]] || "";
	return (
		<span className={`membership ${name}`} title={name}>
			{value}
		</span>
	);
}
