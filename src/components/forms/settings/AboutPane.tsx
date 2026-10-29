export default function AboutPane() {
	const dependencies = import.meta.env.GAMJA_DEPENDENCIES ?? [];
	return (
		<>
			<h3 className="settings-heading">Gamja</h3>
			<dl className="settings-card about-versions">
				<div className="settings-row">
					<dt>Version</dt>
					<dd title="gamja version">{import.meta.env.GAMJA_VERSION || "dev"}</dd>
				</div>
			</dl>
			<p className="about-links">
				<a href="https://github.com/pbtrung/gamja" target="_blank" rel="noreferrer">
					Source code
				</a>
				{" · "}
				<a href="https://www.gnu.org/licenses/agpl-3.0.en.html" target="_blank" rel="noreferrer">
					AGPLv3 license
				</a>
			</p>

			<h3 className="settings-heading">Dependencies</h3>
			<dl className="settings-card about-versions">
				{dependencies.map(({ name, version }) => (
					<div className="settings-row" key={name}>
						<dt>{name}</dt>
						<dd>{version}</dd>
					</div>
				))}
			</dl>
		</>
	);
}
