import decorateGraph, { Edge, Graph } from 'thezeus/src/graph';

export type Direction = 'source' | 'composition';

export interface ConeEntry {
	path: string;
	/** Hops from the origin along the cone's own direction. The origin is 0. */
	hop: number;
}

type Links = Record<string, Record<string, number>>;

/** Obsidian's resolvedLinks, as a plain adjacency map. */
function forward(links: Links): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const [from, targets] of Object.entries(links)) {
		if (!out.has(from)) out.set(from, []);
		for (const to of Object.keys(targets)) {
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
function reach(graph: Map<string, string[]>, origin: string): Map<string, number> {
	const hop = new Map<string, number>([[origin, 0]]);
	const queue = [origin];
	while (queue.length) {
		const node = queue.shift()!;
		for (const next of graph.get(node) ?? []) {
			if (!hop.has(next)) {
				hop.set(next, hop.get(node)! + 1);
				queue.push(next);
			}
		}
	}
	return hop;
}

/**
 * The origin's cone, ordered so every note precedes the notes that depend on it.
 *
 * Ordering always follows the *forward* links, whichever direction the cone was
 * gathered in: a note depends on what it links to, so its dependencies must be
 * read first. That makes the origin last in a source cone (it depends on all of
 * them) and first in a composition cone (they all depend on it).
 *
 * The order is the depth-first post-order, which is dependencies-first by
 * construction and, unlike a strict topological sort, still emits every note
 * when the graph is not acyclic - degrading to as topological as the graph
 * allows rather than refusing outright.
 */
export function cone(links: Links, origin: string, direction: Direction): ConeEntry[] {
	const fwd = forward(links);
	if (!fwd.has(origin)) return [];

	const hop = reach(direction === 'source' ? fwd : invert(fwd), origin);

	// Sorting the vertices and each vertex's neighbours is what makes the order
	// stable: the library's walk follows whatever order it is handed, and
	// Obsidian's resolvedLinks is keyed in index order, which shifts as the
	// vault is re-indexed.
	const V = [...hop.keys()].sort();
	const inCone = new Set(V);

	const phi: Record<number, Edge> = {};
	let id = 1;
	for (const from of V) {
		for (const to of [...(fwd.get(from) ?? [])].sort()) {
			if (inCone.has(to)) phi[id++] = { from, to, type: 'directed' };
		}
	}

	const graph: Graph = { V, E: Object.keys(phi).map(Number), phi };
	const order = decorateGraph(graph).depthFirstOrder().post;

	return order.map((path) => ({ path, hop: hop.get(path)! }));
}
