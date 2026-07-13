import { describe, expect, it } from 'vitest';
import { cone, Direction } from './cone';

// [[tinyGraph]] - 13 vertices, 15 edges, acyclic. Kept in step with the note.
const TINY_GRAPH: [number, number][] = [
	[2, 3], [6, 0], [0, 1], [2, 0], [11, 12], [9, 12], [9, 10], [9, 11],
	[3, 5], [8, 7], [5, 4], [0, 5], [6, 4], [6, 9], [7, 6],
];

/** Edge pairs -> the shape Obsidian hands us. */
function links(edges: [number, number][]): Record<string, Record<string, number>> {
	const out: Record<string, Record<string, number>> = {};
	for (const [from, to] of edges) {
		(out[String(from)] ??= {})[String(to)] = 1;
		out[String(to)] ??= {};
	}
	return out;
}

const paths = (entries: { path: string }[]) => entries.map((e) => e.path);

/** Every edge inside the result must run from a dependency to its dependent. */
function violations(entries: { path: string }[], edges: [number, number][]): number {
	const pos = new Map(entries.map((e, i) => [e.path, i]));
	let bad = 0;
	for (const [from, to] of edges) {
		const f = pos.get(String(from));
		const t = pos.get(String(to));
		// `from` depends on `to`, so `to` must be listed first
		if (f !== undefined && t !== undefined && t > f) bad++;
	}
	return bad;
}

const coneOf = (origin: string, direction: Direction = 'source') =>
	cone(links(TINY_GRAPH), origin, direction);

describe('cone', () => {
	describe('source cone', () => {
		it('gathers everything reachable down the links', () => {
			// 8 -> 7 -> 6 -> {0,4,9}, and onward
			expect(paths(coneOf('8')).sort()).toEqual(
				['0', '1', '10', '11', '12', '4', '5', '6', '7', '8', '9'],
			);
		});

		it('lists every note before the notes that depend on it', () => {
			expect(violations(coneOf('8'), TINY_GRAPH)).toBe(0);
		});

		it('puts the origin last - it depends, transitively, on all of them', () => {
			const order = paths(coneOf('8'));
			expect(order[order.length - 1]).toBe('8');
		});

		it('records hop distance from the origin', () => {
			const hops = new Map(coneOf('8').map((e) => [e.path, e.hop]));
			expect(hops.get('8')).toBe(0);
			expect(hops.get('7')).toBe(1);
			expect(hops.get('6')).toBe(2);
			expect(hops.get('9')).toBe(3);
			expect(hops.get('12')).toBe(4);
		});
	});

	describe('composition cone', () => {
		it('gathers everything that reaches the origin, up the links', () => {
			// who reaches 4? 5,0,2,6,7,8,3 - and 4 itself
			expect(paths(coneOf('4', 'composition')).sort()).toEqual(
				['0', '2', '3', '4', '5', '6', '7', '8'],
			);
		});

		it('still lists dependencies first, so the origin comes first here', () => {
			const entries = coneOf('4', 'composition');
			expect(violations(entries, TINY_GRAPH)).toBe(0);
			expect(paths(entries)[0]).toBe('4'); // everything in the cone depends on it
		});
	});

	describe('a note on its own', () => {
		it('returns just the origin when nothing links either way', () => {
			// 1 is a sink: it depends on nothing
			expect(paths(coneOf('1'))).toEqual(['1']);
		});

		it('returns nothing for a note absent from the graph', () => {
			expect(coneOf('999')).toEqual([]);
		});
	});

	describe('cycles', () => {
		// A strict topological sort refuses a cyclic graph outright. The cone must
		// still render: it degrades to as topological as the graph allows.
		const CYCLIC: [number, number][] = [[0, 1], [1, 2], [2, 0], [0, 3]];

		it('emits every note rather than refusing', () => {
			const entries = cone(links(CYCLIC), '0', 'source');
			expect(paths(entries).sort()).toEqual(['0', '1', '2', '3']);
		});

		it('terminates', () => {
			expect(() => cone(links(CYCLIC), '0', 'source')).not.toThrow();
		});
	});

	describe('determinism', () => {
		it('gives the same order across runs', () => {
			expect(paths(coneOf('8'))).toEqual(paths(coneOf('8')));
		});

		it('gives the same order when the links are enumerated differently', () => {
			// The vault's link order shifts as Obsidian re-indexes; the cone must not.
			const shuffled = [...TINY_GRAPH].reverse();
			const a = cone(links(TINY_GRAPH), '8', 'source');
			const b = cone(links(shuffled), '8', 'source');
			expect(paths(a)).toEqual(paths(b));
		});
	});
});
