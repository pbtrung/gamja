import type { CSSProperties } from "react";
import type { MessageLayout } from "../../../state";
import type { Theme } from "../../../themes";

export function ThemePreview({ theme }: { theme: Theme }) {
	const [bg, fg, accent] = theme.swatch;
	const style = { "--sw-bg": bg, "--sw-fg": fg, "--sw-accent": accent } as CSSProperties;
	return (
		<span className={"theme-preview" + (theme.scheme === "system" ? " system" : "")} style={style}>
			<span className="theme-preview-sidebar">
				<span className="theme-preview-item active" />
				<span className="theme-preview-item" />
				<span className="theme-preview-item" />
			</span>
			<span className="theme-preview-chat">
				<span className="theme-preview-line" style={{ width: "70%" }} />
				<span className="theme-preview-line" style={{ width: "45%" }} />
				<span className="theme-preview-line accent" style={{ width: "55%" }} />
			</span>
		</span>
	);
}

export function LayoutPreview({ layout }: { layout: MessageLayout }) {
	if (layout === "comfortable") {
		return (
			<span className="layout-preview comfortable" aria-hidden="true">
				{[0, 1].map((i) => (
					<span className="layout-preview-group" key={i}>
						<span className="layout-preview-avatar" />
						<span className="layout-preview-lines">
							<span className="layout-preview-line name" />
							<span className="layout-preview-line" style={{ width: i ? "60%" : "85%" }} />
						</span>
					</span>
				))}
			</span>
		);
	}
	if (layout === "columns") {
		return (
			<span className="layout-preview columns" aria-hidden="true">
				{["70%", "45%", "85%", "55%"].map((width, i) => (
					<span className="layout-preview-row" key={i}>
						<span className="layout-preview-time" />
						<span className="layout-preview-prefix">
							<span
								className="layout-preview-line name"
								style={{ width: i < 2 ? "2.25rem" : "1.5rem" }}
							/>
						</span>
						<span className="layout-preview-line" style={{ width }} />
					</span>
				))}
			</span>
		);
	}
	if (layout === "bubbles") {
		return (
			<span className="layout-preview bubbles" aria-hidden="true">
				<span className="layout-preview-group">
					<span className="layout-preview-avatar" />
					<span className="layout-preview-bubble" style={{ width: "55%" }} />
				</span>
				<span className="layout-preview-bubble joined" style={{ width: "35%" }} />
				<span className="layout-preview-bubble mine" style={{ width: "45%" }} />
			</span>
		);
	}
	return (
		<span className="layout-preview compact" aria-hidden="true">
			{["80%", "60%", "90%", "50%"].map((width, i) => (
				<span className="layout-preview-row" key={i}>
					<span className="layout-preview-time" />
					<span className="layout-preview-line name" />
					<span className="layout-preview-line" style={{ width }} />
				</span>
			))}
		</span>
	);
}
