import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import ErrorBoundary from "../../src/components/ErrorBoundary";

function Bomb({ explode }: { explode: boolean }) {
	if (explode) {
		throw new Error("kaboom");
	}
	return <p>all good</p>;
}

describe("ErrorBoundary", () => {
	it("shows a fallback and recovers", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const onError = vi.fn();
		function Harness() {
			const [explode, setExplode] = useState(true);
			return (
				<>
					<button onClick={() => setExplode(false)}>defuse</button>
					<ErrorBoundary onError={onError}>
						<Bomb explode={explode} />
					</ErrorBoundary>
				</>
			);
		}
		render(<Harness />);
		expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
		expect(screen.getByText("kaboom")).toBeInTheDocument();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "kaboom" }),
			expect.anything(),
		);

		await userEvent.click(screen.getByRole("button", { name: "defuse" }));
		await userEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(screen.getByText("all good")).toBeInTheDocument();
	});

	it("supports a custom fallback", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		render(
			<ErrorBoundary fallback={(err) => <p>custom: {err.message}</p>}>
				<Bomb explode />
			</ErrorBoundary>,
		);
		expect(screen.getByText("custom: kaboom")).toBeInTheDocument();
	});
});
