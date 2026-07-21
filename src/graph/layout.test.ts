import { describe, expect, it } from 'vitest';
import { ConeEdge } from './cone';
import { Layout, layout } from './layout';

const entry = (path: string, layer: number) => ({ path, layer });
const edge = (from: string, to: string): ConeEdge => ({ from, to });

const columns = (result: Layout) =>
	new Map(result.nodes.map((n) => [n.path, n.column]));
const rows = (result: Layout) => new Map(result.nodes.map((n) => [n.path, n.row]));

/** Which paths sit in a row, left to right. */
const row = (result: Layout, r: number) =>
	result.nodes.filter((n) => n.row === r).sort((a, b) => a.column - b.column).map((n) => n.path);

/**
 * Links that cross, counted between adjacent rows.
 *
 * Two links crossing is two pairs of endpoints in opposite order: one starts to
 * the left of the other and ends to its right. That is the whole of what the
 * ordering is trying to avoid.
 */
function crossings(result: Layout, edges: ConeEdge[]): number {
	const col = columns(result);
	const drawn = edges.filter((e) => col.has(e.from) && col.has(e.to));
	let count = 0;
	for (let i = 0; i < drawn.length; i++) {
		for (let j = i + 1; j < drawn.length; j++) {
			const a = drawn[i]!;
			const b = drawn[j]!;
			const tail = col.get(a.from)! - col.get(b.from)!;
			const head = col.get(a.to)! - col.get(b.to)!;
			if (tail * head < 0) count++;
		}
	}
	return count;
}

describe('layout', () => {
	describe('rows', () => {
		it('puts the origin alone at the top', () => {
			const result = layout(
				[entry('O', 0), entry('A', 1), entry('B', 1)],
				[edge('O', 'A'), edge('O', 'B')],
			);
			expect(row(result, 0)).toEqual(['O']);
			expect(row(result, 1).sort()).toEqual(['A', 'B']);
		});

		it('never lets a link run sideways or back up', () => {
			// This is what the layer buys, and why the drawing needs no arrowheads to
			// be read: every link steps strictly down at least one row.
			const edges = [edge('O', 'A'), edge('O', 'C'), edge('A', 'B'), edge('B', 'C')];
			const result = layout(
				[entry('O', 0), entry('A', 1), entry('B', 2), entry('C', 3)],
				edges,
			);
			const r = rows(result);
			for (const { from, to } of edges) expect(r.get(to)!).toBeGreaterThan(r.get(from)!);
		});

		it('compacts layers a filter left gaps in', () => {
			// A filtered cone keeps its notes' original layers, so what survives is
			// numbered 0, 3, 7 - and drawing 0, 1, 2 as empty rows is a band of
			// whitespace that says nothing.
			const result = layout([entry('O', 0), entry('A', 3), entry('B', 7)], []);
			expect(result.height).toBe(3);
			expect([...rows(result).values()].sort()).toEqual([0, 1, 2]);
		});
	});

	describe('columns', () => {
		it('gives every note in a row its own, from zero up', () => {
			const result = layout(
				[entry('O', 0), entry('A', 1), entry('B', 1), entry('C', 1)],
				[edge('O', 'A'), edge('O', 'B'), edge('O', 'C')],
			);
			expect(row(result, 1).length).toBe(3);
			expect(result.nodes.filter((n) => n.row === 1).map((n) => n.column).sort())
				.toEqual([0, 1, 2]);
		});

		it('reports the widest row as the width', () => {
			const result = layout(
				[entry('O', 0), entry('A', 1), entry('B', 1), entry('C', 2)],
				[edge('O', 'A'), edge('O', 'B'), edge('A', 'C')],
			);
			expect(result.width).toBe(2);
		});
	});

	describe('crossings', () => {
		it('uncrosses a pair of links that started crossed', () => {
			// B is left of C, but B points right to E and C points left to D. Ordering
			// the bottom row as [E, D] undoes it - and nothing else can, because the
			// rows themselves are fixed by the layer.
			const edges = [
				edge('O', 'B'), edge('O', 'C'), edge('B', 'E'), edge('C', 'D'),
			];
			const entries = [
				entry('O', 0), entry('B', 1), entry('C', 1), entry('D', 2), entry('E', 2),
			];
			expect(crossings(layout(entries, edges), edges)).toBe(0);
			expect(row(layout(entries, edges), 2)).toEqual(['E', 'D']);
		});

		it('leaves a drawing that cannot be uncrossed alone rather than failing', () => {
			// K3,3-ish: every note on top points at every note below, so some links
			// must cross whatever the order. The heuristic is not asked to promise
			// otherwise - only to terminate and produce a valid drawing.
			const top = ['A', 'B', 'C'];
			const bottom = ['X', 'Y', 'Z'];
			const edges = top.flatMap((t) => bottom.map((b) => edge(t, b)));
			const entries = [
				...top.map((p) => entry(p, 0)),
				...bottom.map((p) => entry(p, 1)),
			];
			const result = layout(entries, edges);
			expect(result.nodes.length).toBe(6);
			expect(crossings(result, edges)).toBeGreaterThanOrEqual(0);
		});

		it('holds a note with no links roughly where it was, not off at one end', () => {
			const edges = [edge('O', 'A'), edge('O', 'C')];
			const result = layout(
				[entry('O', 0), entry('A', 1), entry('LOOSE', 1), entry('C', 1)],
				edges,
			);
			expect(row(result, 1)).toContain('LOOSE');
			expect(row(result, 1).indexOf('LOOSE')).not.toBe(0);
		});
	});

	describe('determinism', () => {
		it('lays the same cone out the same way every time', () => {
			const entries = [
				entry('O', 0), entry('A', 1), entry('B', 1), entry('C', 2), entry('D', 2),
			];
			const edges = [
				edge('O', 'A'), edge('O', 'B'), edge('A', 'C'), edge('B', 'D'), edge('A', 'D'),
			];
			expect(layout(entries, edges).nodes).toEqual(layout(entries, edges).nodes);
		});

		it('ignores links to notes that are not being drawn', () => {
			// A filtered cone still has links pointing out of it; they must not pull on
			// the ordering of what is left.
			const entries = [entry('O', 0), entry('A', 1)];
			const withGhost = layout(entries, [edge('O', 'A'), edge('A', 'GONE')]);
			expect(withGhost.nodes).toEqual(layout(entries, [edge('O', 'A')]).nodes);
		});
	});

	it('draws nothing when there is nothing to draw', () => {
		expect(layout([], [])).toEqual({ nodes: [], width: 0, height: 0 });
	});
});
