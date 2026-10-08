import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";

interface Props {
	children: ReactNode;
	/** Rendered instead of the default full-page fallback */
	fallback?: (error: Error, reset: () => void) => ReactNode;
	onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
	error: Error | null;
}

/** Catch rendering errors so that a bug doesn't blank the whole app. */
export default class ErrorBoundary extends Component<Props, State> {
	override state: State = { error: null };

	static getDerivedStateFromError(error: unknown): State {
		return { error: error instanceof Error ? error : new Error(String(error)) };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error("Rendering error:", error, info.componentStack);
		this.props.onError?.(error, info);
	}

	reset = (): void => {
		this.setState({ error: null });
	};

	override render(): ReactNode {
		const { error } = this.state;
		if (!error) {
			return this.props.children;
		}
		if (this.props.fallback) {
			return this.props.fallback(error, this.reset);
		}
		return (
			<div className="error-boundary" role="alert">
				<div className="error-boundary-card">
					<TriangleAlert className="error-boundary-icon" aria-hidden="true" />
					<h1>Something went wrong</h1>
					<p className="muted">gamja hit an unexpected error. Your connection settings are safe.</p>
					<pre className="error-boundary-details">{error.message}</pre>
					<div className="row-actions">
						<button type="button" className="btn" onClick={this.reset}>
							Try again
						</button>
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => window.location.reload()}
						>
							<RotateCw aria-hidden="true" /> Reload
						</button>
					</div>
				</div>
			</div>
		);
	}
}
