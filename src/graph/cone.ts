import decorateGraph, { Edge, Graph } from 'thezeus/src/graph';

export type Direction = 'source' | 'composition';

export interface ConeEntry {
	path: string;
	/** The *shortest* route from the origin: how far away the note is. */
	hop: number;
	/**
	 * The *longest* route from the origin: how deep the note sits.
	 *
	 * This is the sort key. Hop cannot be, because a note can be one link from the
	 * origin and still lie beneath everything else in the cone - it is reached
	 * directly and again the long way round.
	 */
	layer: number;
}

type Links = Record<string, Record<string, number>>;

/**
 * A file the cone is allowed to travel through.
 *
 * Only notes. A canvas is an index, not a concept: it sits *under* an abstract
 * note yet links down to every note that abstraction covers, so travelling
 * through one turns a note into its own dependency. `Graph` embeds a canvas of
 * graph algorithms, and without this the source cone of `Iterate` comes back
 * carrying `Breadth First Search` - a note that depends on `Iterate`, not the
 * other way round. Canvases are also where most of the graph's cycles live.
 */
function traversable(path: string): boolean {
	return path.endsWith('.md');
}

/** Obsidian's resolvedLinks, as a plain adjacency map over notes. */
function forward(links: Links): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const [from, targets] of Object.entries(links)) {
		if (!traversable(from)) continue;
		if (!out.has(from)) out.set(from, []);
		for (const to of Object.keys(targets)) {
			if (!traversable(to)) continue;
			out.get(from)!.push(to);
			if (!out.has(to)) out.set(to, []);
		}
	}
	return out;
}

function invert(graph: Map<string, string[]>): Map<string, string[]> {
	const out = new Map<string, string[]>([...graph.keys()].map((n) => [n, [] as string[]]));
	for (const [from, tos] of graph) {
		for (const to of tos) {
			if (!out.has(to)) out.set(to, []);
			out.get(to)!.push(from);
		}
	}
	return out;
}

/**
 * Everything reachable from the origin, and how far away it is.
 *
 * The direction decides only *membership*: down the links for the source cone,
 * up them for the composition cone.
 */
function reach(graph: Map<string, string[]>, origin: string, maxHop: number): Map<string, number> {
	const hop = new Map<string, number>([[origin, 0]]);
	const queue = [origin];
	while (queue.length) {
		const node = queue.shift()!;
		const next = hop.get(node)! + 1;
		if (next > maxHop) continue;
		for (const neighbour of graph.get(node) ?? []) {
			if (!hop.has(neighbour)) {
				hop.set(neighbour, next);
				queue.push(neighbour);
			}
		}
	}
	return hop;
}

/**
 * The origin's cone, ordered outward from the origin.
 *
 * Both the walk and the ordering follow the cone's own direction: down the links
 * for a source cone, up them for a composition cone. So the order always reads
 * away from the note you are standing on - first what it links to, then what
 * those link to - and it is a topological order of that direction: no note is
 * listed before one it reaches.
 *
 * The origin itself is dropped. It is the note being looked at; listing it back
 * is noise.
 *
 * Hop distance is reported but is deliberately NOT the sort key, and the two do
 * not agree. Hop is the *shortest* route from the origin, so an abstract note
 * can be one hop away and still sit deep in the structure - `Adjacency` links
 * straight to `Node`, and also reaches it again through `Graph` and `Hop`, which
 * both depend on it. Sorting by hop would list `Node` before the notes that
 * depend on it. The order respects the links; the number just says how far.
 *
 * The order is the depth-first reverse post-order. Unlike a strict topological
 * sort it still emits every note when the graph is not acyclic, degrading to as
 * ordered as the graph allows rather than refusing outright.
 *
 * `maxHop` bounds how far the walk travels, and is unbounded by default. A
 * composition cone usually wants a bound: an abstract note is depended on by
 * nearly everything downstream of it, so its cone runs to most of the vault and
 * says little. The near field is where the answer lives.
 */
export function cone(
	links: Links,
	origin: string,
	direction: Direction,
	maxHop: number = Infinity,
): ConeEntry[] {
	const fwd = forward(links);
	if (!fwd.has(origin)) return [];

	const walk = direction === 'source' ? fwd : invert(fwd);
	const hop = reach(walk, origin, maxHop);

	// Sorting the vertices and each vertex's neighbours is what makes the order
	// stable: the library's walk follows whatever order it is handed, and
	// Obsidian's resolvedLinks is keyed in index order, which shifts as the
	// vault is re-indexed.
	const V = [...hop.keys()].sort();
	const inCone = new Set(V);

	const phi: Record<number, Edge> = {};
	let id = 1;
	for (const from of V) {
		for (const to of [...(walk.get(from) ?? [])].sort()) {
			if (inCone.has(to)) phi[id++] = { from, to, type: 'directed' };
		}
	}

	const graph: Graph = { V, E: Object.keys(phi).map(Number), phi };
	// Every note in the cone is reachable from the origin, so the origin finishes
	// last and heads the reverse post-order. That order is topological but reads
	// as a depth-first walk - it plunges down one branch before taking the next -
	// so it is used only to relax the layers below, in one pass.
	const topological = decorateGraph(graph).depthFirstOrder().reversePost;

	// A note's layer is the LONGEST route to it from the origin, not the shortest.
	// Longest is what makes the layering an order: every link steps strictly up a
	// layer, so a note can never share a layer with one it reaches, and can never
	// be listed before it. The shortest route - the hop - carries no such promise:
	// `Adjacency` links straight to `Node` (hop 1) and also reaches it through
	// `Graph` and `Hop`, which both depend on it, so `Node` sits at the bottom of
	// the structure while sitting one step from the origin.
	const layer = new Map<string, number>(V.map((v) => [v, 0]));
	for (const from of topological) {
		for (const to of walk.get(from) ?? []) {
			if (inCone.has(to)) {
				layer.set(to, Math.max(layer.get(to)!, layer.get(from)! + 1));
			}
		}
	}

	// Layer decides the order; hop then name only break ties, and a tie means the
	// two notes do not reach each other, so any order between them is valid.
	const ordered = V.filter((path) => path !== origin).sort(
		(a, b) =>
			layer.get(a)! - layer.get(b)! ||
			hop.get(a)! - hop.get(b)! ||
			a.localeCompare(b),
	);

	return ordered.map((path) => ({
		path,
		hop: hop.get(path)!,
		layer: layer.get(path)!,
	}));
}
