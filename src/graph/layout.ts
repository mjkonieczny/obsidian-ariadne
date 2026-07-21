import { ConeEdge } from './cone';

/**
 * A note's place in the drawing: which row, and where along it.
 *
 * Both are indices, not pixels. Where the rows and columns actually land on
 * screen is the view's business; how they are ordered is this module's.
 */
export interface LayoutNode {
	path: string;
	/** Row, counted from the origin down. */
	row: number;
	/** Position along the row, left to right. */
	column: number;
}

export interface Layout {
	nodes: LayoutNode[];
	/** Columns in the widest row - how wide the drawing has to be. */
	width: number;
	/** How many rows there are. */
	height: number;
}

/**
 * How many times the ordering is swept.
 *
 * Each sweep is a pass over every node and its neighbours, so the cost is linear
 * in the edges and the count is the whole of it. Four is the usual place the
 * heuristic stops paying: the first two do nearly all the work, and past that
 * the orderings mostly oscillate between equally good arrangements.
 */
const SWEEPS = 4;

/** The middle of a list of positions - what a node wants to sit above or below. */
function median(positions: number[]): number | null {
	if (positions.length === 0) return null;
	const sorted = [...positions].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2
		? sorted[middle]!
		: (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Lay a cone out in rows, and order each row so the links cross as little as
 * possible.
 *
 * The rows are given, not chosen. A cone's layer is already the longest route
 * from the origin, which is exactly what a layered drawing needs: every link
 * steps strictly down at least one row, so no link ever runs sideways or back up
 * and the drawing reads top to bottom without being asked to. The hop distance
 * could not do this - it is the shortest route, and a note one hop out can sit
 * beneath everything else in the cone.
 *
 * What is left is the order *within* a row, and that is the only thing here that
 * is a choice. Ordering rows to minimise link crossings is NP-hard, so this is
 * the standard median heuristic: sweep down putting each note above the middle
 * of what points at it, sweep up putting it below the middle of what it points
 * to, and repeat. It does not promise the fewest crossings; it reliably gets
 * most of the way there for a pass over the edges.
 *
 * Layers are compacted to contiguous rows. A filtered cone - by tag, property or
 * hop - keeps its notes' original layers, so the layers it retains have gaps in
 * them, and drawing a gap as an empty row is a band of whitespace that means
 * nothing.
 *
 * Ties keep the order they came in, and the caller's order is deterministic, so
 * the drawing is too: the same cone lays out the same way on every render.
 */
export function layout(
	entries: { path: string; layer: number }[],
	edges: ConeEdge[],
): Layout {
	if (entries.length === 0) return { nodes: [], width: 0, height: 0 };

	const ranks = [...new Set(entries.map((e) => e.layer))].sort((a, b) => a - b);
	const rank = new Map(ranks.map((layer, index) => [layer, index]));

	const rows: string[][] = ranks.map(() => []);
	for (const entry of entries) rows[rank.get(entry.layer)!]!.push(entry.path);

	// Only edges between notes actually being drawn can pull on the ordering.
	const drawn = new Set(entries.map((e) => e.path));
	const into = new Map<string, string[]>();
	const outOf = new Map<string, string[]>();
	const add = (map: Map<string, string[]>, key: string, value: string) => {
		const list = map.get(key);
		if (list) list.push(value);
		else map.set(key, [value]);
	};
	for (const { from, to } of edges) {
		if (!drawn.has(from) || !drawn.has(to)) continue;
		add(outOf, from, to);
		add(into, to, from);
	}

	const column = new Map<string, number>();
	const index = () => {
		for (const row of rows) row.forEach((path, i) => column.set(path, i));
	};
	index();

	/**
	 * Re-order one row by where its neighbours sit.
	 *
	 * A note with no neighbour in the direction being swept has nothing to be
	 * pulled towards, so it keeps the column it already has - which holds it
	 * roughly in place instead of collecting all such notes at one end.
	 */
	const sweep = (row: string[], neighbours: Map<string, string[]>) => {
		const keys = new Map(
			row.map((path) => {
				const positions = (neighbours.get(path) ?? []).map((n) => column.get(n)!);
				return [path, median(positions) ?? column.get(path)!];
			}),
		);
		const was = new Map(row.map((path, i) => [path, i]));
		row.sort((a, b) => keys.get(a)! - keys.get(b)! || was.get(a)! - was.get(b)!);
	};

	for (let pass = 0; pass < SWEEPS; pass++) {
		// Down: a note settles above the middle of whatever points at it.
		for (let r = 1; r < rows.length; r++) sweep(rows[r]!, into);
		index();
		// Up: and then below the middle of whatever it points to. Both directions
		// are needed - one alone only ever tidies the rows it sweeps into.
		for (let r = rows.length - 2; r >= 0; r--) sweep(rows[r]!, outOf);
		index();
	}

	const nodes: LayoutNode[] = [];
	rows.forEach((row, r) =>
		row.forEach((path, c) => nodes.push({ path, row: r, column: c })),
	);

	return {
		nodes,
		width: Math.max(...rows.map((row) => row.length)),
		height: rows.length,
	};
}
