import { describe, expect, it } from 'vitest';
import { cone, coneEdges, Direction, forward } from './cone';

// [[tinyGraph]] - 13 vertices, 15 edges, acyclic. Kept in step with the note.
const TINY_GRAPH: [number, number][] = [
	[2, 3], [6, 0], [0, 1], [2, 0], [11, 12], [9, 12], [9, 10], [9, 11],
	[3, 5], [8, 7], [5, 4], [0, 5], [6, 4], [6, 9], [7, 6],
];

// Vertices are note paths, because the cone only travels through notes - a
// canvas is an index that links down to what its abstraction covers, so
// travelling one would make a note its own dependency.
const note = (v: number | string) => `Notes/${v}.md`;

/** Edge pairs -> the shape Obsidian hands us. */
function links(edges: [number, number][]): Record<string, Record<string, number>> {
	const out: Record<string, Record<string, number>> = {};
	for (const [from, to] of edges) {
		(out[note(from)] ??= {})[note(to)] = 1;
		out[note(to)] ??= {};
	}
	return out;
}

/** Back to bare vertex names, so the expectations read as the graph does. */
const paths = (entries: { path: string }[]) =>
	entries.map((e) => e.path.replace(/^Notes\//, '').replace(/\.md$/, ''));

/**
 * Edges the order must respect, counted against the cone's own direction.
 *
 * The list reads outward from the origin, so no note may be listed before one it
 * reaches. In a source cone that means a note precedes what it links to; in a
 * composition cone the walk runs up the links, so it is the other way round.
 */
function violations(
	entries: { path: string }[],
	edges: [number, number][],
	direction: Direction = 'source',
): number {
	const pos = new Map(entries.map((e, i) => [e.path, i]));
	let bad = 0;
	for (const [from, to] of edges) {
		// the edge as the cone walks it
		const [tail, head] = direction === 'source' ? [from, to] : [to, from];
		const t = pos.get(note(tail));
		const h = pos.get(note(head));
		if (t !== undefined && h !== undefined && t > h) bad++;
	}
	return bad;
}

const coneOf = (origin: string, direction: Direction = 'source') =>
	cone(links(TINY_GRAPH), note(origin), direction);

describe('cone', () => {
	describe('the origin', () => {
		it('is not listed - it is the note being looked at', () => {
			expect(paths(coneOf('8'))).not.toContain('8');
			expect(paths(coneOf('4', 'composition'))).not.toContain('4');
		});

		it('leaves an empty list when the note reaches nothing', () => {
			// 1 is a sink: it links to nothing, so its source cone is empty
			expect(coneOf('1')).toEqual([]);
		});

		it('leaves an empty list for a note absent from the graph', () => {
			expect(coneOf('999')).toEqual([]);
		});
	});

	describe('source cone', () => {
		it('gathers everything reachable down the links', () => {
			// 8 -> 7 -> 6 -> {0,4,9}, and onward. 8 itself is not listed.
			expect(paths(coneOf('8')).sort()).toEqual(
				['0', '1', '10', '11', '12', '4', '5', '6', '7', '9'],
			);
		});

		it('reads outward: no note is listed before one it links to', () => {
			expect(violations(coneOf('8'), TINY_GRAPH, 'source')).toBe(0);
		});

		it('starts with what the origin links to, not with a leaf', () => {
			// 8 links only to 7, so 7 heads the list
			expect(paths(coneOf('8'))[0]).toBe('7');
		});

		it('records hop distance from the origin', () => {
			const hops = new Map(coneOf('8').map((e) => [e.path, e.hop]));
			expect(hops.get(note('7'))).toBe(1);
			expect(hops.get(note('6'))).toBe(2);
			expect(hops.get(note('9'))).toBe(3);
			expect(hops.get(note('12'))).toBe(4);
		});

		it('does not sort by hop - an abstract note can be near and still deep', () => {
			// 4 is 3 hops from 8 (8->7->6->4) yet also sits under 5, which is 4 hops
			// out. It cannot be listed before 5, which reaches it.
			const order = paths(coneOf('8'));
			expect(order.indexOf('5')).toBeLessThan(order.indexOf('4'));
			const hops = new Map(coneOf('8').map((e) => [e.path, e.hop]));
			expect(hops.get(note('4'))!).toBeLessThan(hops.get(note('5'))!);
		});
	});

	describe('composition cone', () => {
		it('gathers everything that reaches the origin, up the links', () => {
			// who reaches 4? 5,0,2,6,7,8,3 - 4 itself is not listed
			expect(paths(coneOf('4', 'composition')).sort()).toEqual(
				['0', '2', '3', '5', '6', '7', '8'],
			);
		});

		it('reads outward too, so the walk runs up the links', () => {
			expect(violations(coneOf('4', 'composition'), TINY_GRAPH, 'composition')).toBe(0);
		});

		it('starts with what links to the origin directly', () => {
			// 5 -> 4 and 6 -> 4 are the direct dependents
			expect(paths(coneOf('4', 'composition'))[0]).toMatch(/^(5|6)$/);
		});
	});

	describe('cycles', () => {
		// A strict topological sort refuses a cyclic graph outright. The cone must
		// still render: it degrades to as ordered as the graph allows.
		const CYCLIC: [number, number][] = [[0, 1], [1, 2], [2, 0], [0, 3]];

		it('emits every note rather than refusing', () => {
			const entries = cone(links(CYCLIC), note('0'), 'source');
			expect(paths(entries).sort()).toEqual(['1', '2', '3']);
		});

		it('terminates', () => {
			expect(() => cone(links(CYCLIC), note('0'), 'source')).not.toThrow();
		});
	});

	describe('what the cone travels through', () => {
		it('does not travel through a canvas', () => {
			// A canvas is an index: it sits under an abstract note yet links down to
			// everything that abstraction covers. Travelling one turns a note into
			// its own dependency - here Graph would reach BFS, which depends on it.
			const withCanvas = {
				'Notes/Iterate.md': { 'Notes/Graph.md': 1 },
				'Notes/Graph.md': { 'Canvas/Algorithms.canvas': 1 },
				'Canvas/Algorithms.canvas': { 'Notes/BFS.md': 1 },
				'Notes/BFS.md': { 'Notes/Iterate.md': 1 },
			};
			const result = cone(withCanvas, 'Notes/Iterate.md', 'source');
			expect(paths(result)).toEqual(['Graph']);
			expect(paths(result)).not.toContain('BFS');
		});
	});

	describe('layer', () => {
		it('is the LONGEST route from the origin, not the shortest', () => {
			// 8 -> 7 -> 6 -> 4 is three hops, but 8 also reaches 4 the long way round
			// through 6 -> 0 -> 5 -> 4, and 5 depends on 4. So 4 must wait for 5.
			const entries = coneOf('8');
			const by = new Map(entries.map((e) => [e.path, e]));
			expect(by.get(note('4'))!.hop).toBe(3);
			expect(by.get(note('4'))!.layer).toBeGreaterThan(by.get(note('4'))!.hop);
		});

		it('is what the list is sorted by', () => {
			const layers = coneOf('8').map((e) => e.layer);
			expect(layers).toEqual([...layers].sort((a, b) => a - b));
		});

		it('never lets a note share a layer with one it reaches', () => {
			const entries = coneOf('8');
			const layer = new Map(entries.map((e) => [e.path, e.layer]));
			for (const [from, to] of TINY_GRAPH) {
				const f = layer.get(note(from));
				const t = layer.get(note(to));
				if (f !== undefined && t !== undefined) expect(t).toBeGreaterThan(f);
			}
		});
	});

	describe('max hop', () => {
		it('bounds how far the walk travels', () => {
			const all = cone(links(TINY_GRAPH), note('8'), 'source');
			const near = cone(links(TINY_GRAPH), note('8'), 'source', 2);
			expect(all.length).toBeGreaterThan(near.length);
			expect(near.every((e) => e.hop <= 2)).toBe(true);
		});

		it('is unbounded by default', () => {
			const all = cone(links(TINY_GRAPH), note('8'), 'source');
			expect(Math.max(...all.map((e) => e.hop))).toBeGreaterThan(2);
		});

		it('still reads outward within the bound', () => {
			expect(violations(cone(links(TINY_GRAPH), note('8'), 'source', 2), TINY_GRAPH, 'source')).toBe(0);
		});
	});

	describe('edges', () => {
		// A listing needs only the notes. A drawing needs what joins them.
		const walk = () => forward(links(TINY_GRAPH));
		const pairs = (edges: { from: string; to: string }[]) =>
			edges.map((e) => `${e.from}->${e.to}`.replace(/Notes\/|\.md/g, ''));

		it('are the links among the notes given, and no others', () => {
			// 8 -> 7 -> 6, and 6 -> 0. 2 -> 0 exists in the graph but 2 is not here.
			expect(pairs(coneEdges(walk(), [note('8'), note('7'), note('6'), note('0')])).sort())
				.toEqual(['6->0', '7->6', '8->7']);
		});

		it('leave out links to notes a filter dropped', () => {
			// The cone still links onward to 4 and 9; neither is being drawn, so
			// neither edge is.
			expect(pairs(coneEdges(walk(), [note('8'), note('7'), note('6')])).sort())
				.toEqual(['7->6', '8->7']);
		});

		it('include the origin, so the drawing has an apex to hang from', () => {
			const withOrigin = coneEdges(walk(), [note('8'), note('7')]);
			expect(pairs(withOrigin)).toEqual(['8->7']);
			// Without it, 7 is a root with nothing above it.
			expect(coneEdges(walk(), [note('7')])).toEqual([]);
		});

		it('come out in the same order however the links were enumerated', () => {
			const a = coneEdges(forward(links(TINY_GRAPH)), [note('8'), note('7'), note('6')]);
			const b = coneEdges(forward(links([...TINY_GRAPH].reverse())), [note('6'), note('8'), note('7')]);
			expect(a).toEqual(b);
		});
	});

	describe('determinism', () => {
		it('gives the same order across runs', () => {
			expect(paths(coneOf('8'))).toEqual(paths(coneOf('8')));
		});

		it('gives the same order when the links are enumerated differently', () => {
			// The vault's link order shifts as Obsidian re-indexes; the cone must not.
			const shuffled = [...TINY_GRAPH].reverse();
			const a = cone(links(TINY_GRAPH), note('8'), 'source');
			const b = cone(links(shuffled), note('8'), 'source');
			expect(paths(a).length).toBe(10); // not vacuously equal on two empty lists
			expect(paths(a)).toEqual(paths(b));
		});
	});
});
