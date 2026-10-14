import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as irc from "../../src/lib/irc";
import MemberList from "../../src/components/MemberList";
import type { User } from "../../src/state";

function setup() {
	const members = new irc.CaseMapMap<string>(null, irc.CaseMapping.RFC1459);
	members.set("bob", "@");
	members.set("carol", "");
	const props = {
		members,
		users: new irc.CaseMapMap<User>(null, irc.CaseMapping.RFC1459),
		prefixes: "@+",
		bouncerNetwork: null,
		canModerate: true,
		onNickClick: vi.fn(),
		onAction: vi.fn(),
	};
	render(<MemberList {...props} />);
	return props;
}

describe("MemberList", () => {
	it("shares one actions menu between members", async () => {
		const props = setup();
		const bob = screen.getByRole("button", { name: "Actions for bob" });
		const carol = screen.getByRole("button", { name: "Actions for carol" });

		await userEvent.click(bob);
		expect(bob).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByRole("menu", { name: "Actions for bob" })).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "Remove operator" })).toBeInTheDocument();

		// Another member's toggle moves the menu there
		await userEvent.click(carol);
		expect(bob).toHaveAttribute("aria-expanded", "false");
		expect(carol).toHaveAttribute("aria-expanded", "true");
		expect(screen.getAllByRole("menu")).toHaveLength(1);
		expect(screen.getByRole("menuitem", { name: "Make operator" })).toBeInTheDocument();

		// The same toggle closes it
		await userEvent.click(carol);
		expect(screen.queryByRole("menu")).toBeNull();
		expect(carol).toHaveAttribute("aria-expanded", "false");

		await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("bob") });
		await userEvent.click(screen.getByRole("menuitem", { name: "Kick" }));
		expect(props.onAction).toHaveBeenCalledWith("bob", "kick");
		expect(screen.queryByRole("menu")).toBeNull();

		await userEvent.click(screen.getByText("carol"));
		expect(props.onNickClick).toHaveBeenCalledWith("carol");
	});

	it("opens the actions from the keyboard", async () => {
		const props = setup();
		const bob = screen.getByRole("button", { name: "Actions for bob" });
		bob.focus();
		await userEvent.keyboard("{Enter}");
		expect(screen.getAllByRole("menuitem")[0]).toHaveFocus();
		await userEvent.keyboard("{Escape}");
		expect(screen.queryByRole("menu")).toBeNull();
		expect(bob).toHaveFocus();

		await userEvent.keyboard("{Enter}{ArrowDown}{Enter}");
		expect(props.onAction).toHaveBeenCalledWith("bob", "whois");
		expect(bob).toHaveFocus();
		expect(bob).toHaveAttribute("aria-expanded", "false");
	});

	it("opens the actions by tapping nicks on touch screens", async () => {
		vi.stubGlobal(
			"matchMedia",
			(query: string) =>
				({
					matches: query === "(hover: none)",
					addEventListener() {},
					removeEventListener() {},
				}) as unknown as MediaQueryList,
		);
		const props = setup();
		await userEvent.click(screen.getByText("carol"));
		expect(props.onNickClick).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole("menuitem", { name: "Send message" }));
		expect(props.onAction).toHaveBeenCalledWith("carol", "message");
	});
});
