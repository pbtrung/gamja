import { RefreshCw } from "lucide-react";
import type { AppState } from "../../app/store";
import { getServerName } from "../../state";

/** Connection losses stay visible while reading any buffer. */
export default function ReconnectBanners({ state }: { state: AppState }) {
	const servers = [...state.servers.values()].filter((server) => server.reconnecting);
	if (servers.length === 0) {
		return null;
	}
	return (
		<div className="reconnect-banners">
			{servers.map((server) => {
				const network = server.bouncerNetID ? state.bouncerNetworks.get(server.bouncerNetID) : null;
				const name = getServerName(server, network);
				return (
					<div className="reconnect-banner" role="status" key={server.id}>
						<RefreshCw className="reconnect-spinner" aria-hidden="true" />
						<span>
							<strong>Connection to {name} lost.</strong> Reconnecting…
						</span>
					</div>
				);
			})}
		</div>
	);
}
