import { useCallback, useState } from "react";
import type { Buffer } from "../../state";
import { useController } from "../../app/context";
import type { AppState } from "../../app/store";
import * as store from "../../store";
import BufferList from "../BufferList";
import FilterInput from "../FilterInput";
import PaneResizer from "../PaneResizer";

interface BufferSidebarProps {
	state: AppState;
	smallScreen: boolean;
}

/** The buffer list, with its filter, a drawer on small screens */
export default function BufferSidebar({ state, smallScreen }: BufferSidebarProps) {
	const app = useController();
	const [bufferFilter, setBufferFilter] = useState("");

	const handleBufferClick = useCallback((buf: Buffer) => app.switchBuffer(buf.id), [app]);
	const handleBufferClose = useCallback((buf: Buffer) => app.close(buf.id), [app]);
	const handleToggleCollapse = useCallback(
		(buf: Buffer, all: boolean) => app.toggleCollapsed(buf.server, all),
		[app],
	);

	return (
		<nav
			id="buffer-list"
			className={state.openPanels.bufferList ? "expand" : state.bufferListHidden ? "hidden" : ""}
			aria-label="Buffers"
		>
			<div className="buffer-list-panel">
				<header className="sidebar-filter">
					<FilterInput
						id="buffer-filter"
						value={bufferFilter}
						onChange={setBufferFilter}
						label="Filter buffers"
						placeholder="Filter buffers"
					/>
				</header>
				<BufferList
					filter={bufferFilter}
					unreadOnly={state.bufferListUnreadOnly}
					buffers={state.buffers}
					servers={state.servers}
					bouncerNetworks={state.bouncerNetworks}
					activeBuffer={state.activeBuffer}
					collapsed={state.collapsedNetworks}
					onBufferClick={handleBufferClick}
					onBufferClose={handleBufferClose}
					onToggleCollapse={handleToggleCollapse}
				/>
			</div>
			{!smallScreen && (
				<PaneResizer
					side="left"
					label="Resize the buffer list"
					controls="buffer-list"
					cssVariable="--buffer-list-custom-width"
					item={store.bufferListWidth}
				/>
			)}
		</nav>
	);
}
