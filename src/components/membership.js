import { html } from "../lib/index.js";
import * as irc from "../lib/irc.js";

export default function Membership(props) {
	if (!props.value) {
		return null;
	}

	// XXX: If we were feeling creative we could generate unique colors for
	// each item in ISUPPORT CHANMODES. But I am not feeling creative.
	const name = irc.STD_MEMBERSHIP_NAMES[props.value[0]] || "";
	return html`
		<span class="membership ${name}" title=${name}>${props.value}</span>
	`;
}
