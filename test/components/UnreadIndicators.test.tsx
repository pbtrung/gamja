import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ChatScroller from "../../src/components/ChatScroller";
import { UnreadSeparator } from "../../src/components/messages/Separators";

it("gives updated history progress a fresh eight seconds in view", () => {
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
			notify(
				[
					{
						isIntersecting: visible,
						intersectionRatio: visible ? 1 : 0,
					} as IntersectionObserverEntry,
				],
				{} as IntersectionObserver,
			),
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
	act(() => vi.advanceTimersByTime(7999));
	expect(screen.getByRole("separator")).toBeInTheDocument();
	act(() => vi.advanceTimersByTime(1));
	expect(screen.queryByRole("separator")).toBeNull();
	unmount();
	expect(disconnect).toHaveBeenCalledTimes(2);
});

it("gives the divider a continuous eight seconds after returning to a hidden browser page", () => {
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
	act(() =>
		notify(
			[{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
			{} as IntersectionObserver,
		),
	);
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
	act(() => vi.advanceTimersByTime(7999));
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

it("doesn't start the divider timer while only part of it is on screen", () => {
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
	const show = (ratio: number) =>
		act(() =>
			notify(
				[{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry],
				{} as IntersectionObserver,
			),
		);
	render(<UnreadSeparator label="200 loaded · more available" />);
	show(0.1);
	act(() => vi.advanceTimersByTime(30000));
	expect(screen.getByRole("separator")).toBeInTheDocument();
	show(1);
	act(() => vi.advanceTimersByTime(7999));
	expect(screen.getByRole("separator")).toBeInTheDocument();
	act(() => vi.advanceTimersByTime(1));
	expect(screen.queryByRole("separator")).toBeNull();
});

it("shows new history progress for eight seconds even if the previous divider expired", () => {
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
	const show = () =>
		act(() =>
			notify(
				[{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
				{} as IntersectionObserver,
			),
		);
	const { rerender } = render(<UnreadSeparator label="200 loaded · more available" refreshKey="page-1" />);
	show();
	act(() => vi.advanceTimersByTime(8000));
	expect(screen.queryByRole("separator")).toBeNull();
	rerender(<UnreadSeparator label="400 loaded · more available" refreshKey="page-2" />);
	show();
	act(() => vi.advanceTimersByTime(7999));
	expect(screen.getByRole("separator")).toHaveAccessibleName("400 loaded · more available");
	act(() => vi.advanceTimersByTime(1));
	expect(screen.queryByRole("separator")).toBeNull();
});

it("doesn't restart or reopen the divider for live messages on the same history page", () => {
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
	const { rerender } = render(<UnreadSeparator label="200 loaded · more available" refreshKey="page-1" />);
	act(() =>
		notify(
			[{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
			{} as IntersectionObserver,
		),
	);
	act(() => vi.advanceTimersByTime(7999));
	rerender(<UnreadSeparator label="201 loaded · more available" refreshKey="page-1" />);
	act(() => vi.advanceTimersByTime(1));
	expect(screen.queryByRole("separator")).toBeNull();
	rerender(<UnreadSeparator label="202 loaded · more available" refreshKey="page-1" />);
	expect(screen.queryByRole("separator")).toBeNull();
});

it("gives the same loaded page a full eight seconds when scrolling away and back", () => {
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
	const show = (visible: boolean) =>
		act(() =>
			notify(
				[
					{
						isIntersecting: visible,
						intersectionRatio: visible ? 1 : 0,
					} as IntersectionObserverEntry,
				],
				{} as IntersectionObserver,
			),
		);
	render(<UnreadSeparator label="400 loaded · more available" refreshKey="page-2" />);
	show(true);
	act(() => vi.advanceTimersByTime(7000));
	show(false);
	act(() => vi.advanceTimersByTime(1000));
	show(true);
	act(() => vi.advanceTimersByTime(7999));
	expect(screen.getByRole("separator")).toHaveAccessibleName("400 loaded · more available");
	act(() => vi.advanceTimersByTime(1));
	expect(screen.queryByRole("separator")).toBeNull();
});
