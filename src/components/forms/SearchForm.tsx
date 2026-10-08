import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import type { Message } from "../../lib/irc";
import { strip as stripANSI } from "../../lib/ansi";
import { getNickColorIndex } from "../../format";

interface SearchResult {
	buffer: string;
	message: Message;
}

interface SearchFormProps {
	/** Buffer to search in, null to search everywhere */
	buffer: string | null;
	initialQuery?: string;
	onSearch: (query: { text: string; in: string | null; from: string | null }) => Promise<SearchResult[]>;
	onSelect: (result: SearchResult) => void;
}

function Highlight({ text, query }: { text: string; query: string }) {
	const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
	if (i < 0) {
		return <>{text}</>;
	}
	return (
		<>
			{text.slice(0, i)}
			<mark>{text.slice(i, i + query.length)}</mark>
			{text.slice(i + query.length)}
		</>
	);
}

export default function SearchForm({ buffer, initialQuery, onSearch, onSelect }: SearchFormProps) {
	const [text, setText] = useState(initialQuery ?? "");
	const [from, setFrom] = useState("");
	const [scope, setScope] = useState<"buffer" | "all">(buffer ? "buffer" : "all");
	const [results, setResults] = useState<SearchResult[] | null>(null);
	const [searchedText, setSearchedText] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		if (!text && !from) {
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const res = await onSearch({ text, in: scope === "buffer" ? buffer : null, from: from || null });
			setResults(res);
			setSearchedText(text);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setResults(null);
		} finally {
			setLoading(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="search-form">
			<div className="input-group field">
				<span className="input-addon" aria-hidden="true">
					<Search />
				</span>
				<input
					type="search"
					name="text"
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder="Search messages"
					aria-label="Search messages"
					autoComplete="off"
					autoFocus
				/>
			</div>
			<div className="search-filters">
				<div className="field">
					<label htmlFor="search-from">From</label>
					<input
						type="text"
						id="search-from"
						value={from}
						onChange={(e) => setFrom(e.target.value)}
						placeholder="Any nickname"
					/>
				</div>
				<div className="field">
					<label htmlFor="search-scope">In</label>
					<select
						id="search-scope"
						value={scope}
						onChange={(e) => setScope(e.target.value as "buffer" | "all")}
					>
						{buffer && <option value="buffer">{buffer}</option>}
						<option value="all">All conversations</option>
					</select>
				</div>
				<button type="submit" className="btn btn-primary" disabled={loading || (!text && !from)}>
					{loading ? <span className="spinner" aria-hidden="true" /> : null} Search
				</button>
			</div>

			{error && (
				<div className="alert alert-danger" role="alert">
					{error}
				</div>
			)}

			{results && (
				<div className="search-results">
					<p className="muted search-count" role="status">
						{results.length === 0
							? "No messages found"
							: `${results.length} message${results.length === 1 ? "" : "s"} found`}
					</p>
					<ul aria-label="Search results">
						{results.map((result) => {
							const msg = result.message;
							const nick = msg.prefix?.name ?? "*";
							const date = msg.tags.time ? new Date(msg.tags.time) : null;
							return (
								<li key={(msg.tags.msgid ?? "") + msg.key + result.buffer + msg.tags.time}>
									<button
										type="button"
										className="search-result"
										disabled={!msg.tags.msgid}
										onClick={() => onSelect(result)}
									>
										<span className="search-result-meta">
											<span className={`nick nick-${getNickColorIndex(nick)}`}>
												{nick}
											</span>
											{scope === "all" && (
												<span className="search-result-buffer">{result.buffer}</span>
											)}
											{date && (
												<time dateTime={date.toISOString()} className="muted">
													{date.toLocaleString()}
												</time>
											)}
										</span>
										<span className="search-result-text">
											<Highlight
												text={stripANSI(msg.params[1] ?? "")}
												query={searchedText}
											/>
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</form>
	);
}
