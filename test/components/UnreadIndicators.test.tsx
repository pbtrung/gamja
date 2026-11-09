import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ChatScroller from "../../src/components/ChatScroller";
import { UnreadSeparator } from "../../src/components/messages/Separators";

it("counts only the divider's visible time, including after its label changes", () => {
	vi.useFakeTimers();
	let notify: IntersectionObserverCallback;
	const disconnect = vi.fn();
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			constructor(callback: IntersectionObserverCallback) {
				notify = callback;
			}
			observe = vi.fn();
			disconnect = disconnect;
		},
	);
	const show = (visible: boolean) =>
		act(() =>
			notify([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver),
		);
	const view = (label: string) => (
		<section role="log">
			<UnreadSeparator label={label} />
		</section>
	);
	const { rerender, unmount } = render(view("200 loaded · more available"));
	act(() => vi.advanceTimersByTime(30000));
	expect(screen.getByRole("separator")).toBeInTheDocument();
	show(true);
	act(() => vi.advanceTimersByTime(4000));
	show(false);
	rerender(view("400 loaded · more available"));
	act(() => vi.advanceTimersByTime(30000));
	expect(screen.getByRole("separator")).toHaveTextContent("400 loaded");
	show(true);
	act(() => vi.advanceTimersByTime(3999));
	expect(screen.getByRole("separator")).toBeInTheDocument();
	act(() => vi.advanceTimersByTime(1));
	expect(screen.queryByRole("separator")).toBeNull();
	unmount();
	expect(disconnect).toHaveBeenCalledOnce();
});

it("doesn't count time while the browser page is hidden", () => {
	vi.useFakeTimers();
	let notify: IntersectionObserverCallback;
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			constructor(callback: IntersectionObserverCallback) {
				notify = callback;
			}
			observe = vi.fn();
			disconnect = vi.fn();
		},
	);
	let hidden = false;
	vi.spyOn(document, "visibilityState", "get").mockImplementation(() => (hidden ? "hidden" : "visible"));
	render(<UnreadSeparator label="200 loaded · more available" />);
	act(() => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
	act(() => vi.advanceTimersByTime(3000));
	act(() => {
		hidden = true;
		document.dispatchEvent(new Event("visibilitychange"));
	});
	act(() => vi.advanceTimersByTime(30000));
	expect(screen.getByRole("separator")).toBeInTheDocument();
	act(() => {
		hidden = false;
		document.dispatchEvent(new Event("visibilitychange"));
	});
	act(() => vi.advanceTimersByTime(4999));
	expect(screen.getByRole("separator")).toBeInTheDocument();
	act(() => vi.advanceTimersByTime(1));
	expect(screen.queryByRole("separator")).toBeNull();
});

it("expires the opening pill after eight seconds without restarting for count changes", async () => {
	vi.useFakeTimers();
	const view = (key: string, label: string) => (
		<ChatScroller
			scrollKey={key}
			unreadKey={key}
			unreadLabel={label}
			unreadMarker=".unread-separator"
			stickTo=".message"
			onScrollTop={vi.fn()}
		>
			<div className="unread-separator">200 loaded · more available</div>
		</ChatScroller>
	);
	const { rerender } = render(view("timed-a", "200+ new since 10:30"));
	expect(screen.getByRole("button", { name: "200+ new since 10:30" })).toBeInTheDocument();
	act(() => vi.advanceTimersByTime(4000));
	rerender(view("timed-a", "201+ new since 10:30"));
	act(() => vi.advanceTimersByTime(3999));
	expect(screen.getByRole("button", { name: "201+ new since 10:30" })).toBeInTheDocument();
	act(() => vi.advanceTimersByTime(1));
	expect(screen.queryByRole("group", { name: "New messages" })).toBeNull();
	rerender(view("timed-a", "451 new since 10:30"));
	expect(screen.queryByRole("group", { name: "New messages" })).toBeNull();
	rerender(view("timed-b", "20 new since 11:00"));
	expect(screen.getByRole("button", { name: "20 new since 11:00" })).toBeInTheDocument();
});

it("doesn't introduce a pill for new messages in an already open buffer", async () => {
	const props = {
		scrollKey: "already-read",
		unreadKey: "already-read",
		unreadLabel: "1 new since 10:30",
		unreadMarker: ".unread-separator",
		stickTo: ".message",
		onScrollTop: vi.fn(),
	};
	const { rerender } = render(
		<ChatScroller {...props}>
			<div>Read messages</div>
		</ChatScroller>,
	);
	rerender(
		<ChatScroller {...props}>
			<div className="unread-separator">1 new message · all loaded</div>
		</ChatScroller>,
	);
	await act(async () => {});
	expect(screen.queryByRole("group", { name: "New messages" })).toBeNull();
});
