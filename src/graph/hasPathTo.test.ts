import { describe, expect, it } from 'vitest';
import { App, TFile } from 'obsidian';
import { hasPathTo } from './hasPathTo';

/**
 * hasPathTo only ever touches `app.metadataCache.resolvedLinks` and `file.path`,
 * so a plain object stands in for the whole Obsidian app.
 *
 * The adjacency map is wrapped in a tripwire: every time the walk looks a note
 * up, we count it, and once the count exceeds the number of notes in the graph
 * we throw. A correct walk consults each note at most once, so the tripwire is
 * unreachable. A walk that revisits notes - one that lost its visited-set, say -
 * would otherwise spin forever in a synchronous loop, which no test timeout can
 * interrupt: it would hang the suite instead of failing it. The tripwire turns
 * that hang into a fast, legible failure.
 */
function vault(links: Record<string, string[]>) {
	const resolvedLinks: Record<string, Record<string, number>> = {};
	for (const [from, targets] of Object.entries(links)) {
		resolvedLinks[from] = {};
		for (const to of targets) resolvedLinks[from][to] = 1;
	}

	const budget = Object.keys(resolvedLinks).length + 1;
	let lookups = 0;

	const tripwired = new Proxy(resolvedLinks, {
		get(target, prop) {
			if (typeof prop === 'string') {
				lookups++;
				if (lookups > budget) {
					throw new Error(
						`walk did not terminate: ${lookups} adjacency lookups in a ${budget - 1}-note graph`,
					);
				}
			}
			return target[prop as string];
		},
	});

	const app = { metadataCache: { resolvedLinks: tripwired } } as unknown as App;
	return { app, lookups: () => lookups };
}

const note = (path: string) => ({ path }) as TFile;

describe('hasPathTo', () => {
	it('follows a direct link', () => {
		const { app } = vault({ 'A.md': ['B.md'] });
		expect(hasPathTo(note('A.md'), note('B.md'), app)).toBe(true);
	});

	it('follows links transitively, past the one-hop horizon', () => {
		const { app } = vault({ 'A.md': ['B.md'], 'B.md': ['C.md'], 'C.md': ['D.md'] });
		expect(hasPathTo(note('A.md'), note('D.md'), app)).toBe(true);
	});

	it('is false when no path exists', () => {
		const { app } = vault({ 'A.md': ['B.md'], 'X.md': ['Y.md'] });
		expect(hasPathTo(note('A.md'), note('Y.md'), app)).toBe(false);
	});

	it('is directed - a link from A to B is not a path from B to A', () => {
		const { app } = vault({ 'A.md': ['B.md'] });
		expect(hasPathTo(note('B.md'), note('A.md'), app)).toBe(false);
	});

	it('reaches a note through either arm of a diamond', () => {
		const { app } = vault({
			'A.md': ['B.md', 'C.md'],
			'B.md': ['D.md'],
			'C.md': ['D.md'],
		});
		expect(hasPathTo(note('A.md'), note('D.md'), app)).toBe(true);
	});

	it('counts a note as reaching itself', () => {
		// The origin is its own cone member: the walk tests the start note before
		// following any edge. The view relies on this - the active note lists itself.
		const { app } = vault({ 'A.md': ['B.md'] });
		expect(hasPathTo(note('A.md'), note('A.md'), app)).toBe(true);
	});

	it('handles a leaf note with no outgoing links', () => {
		const { app } = vault({ 'A.md': ['B.md'] }); // B.md is absent from resolvedLinks
		expect(hasPathTo(note('B.md'), note('A.md'), app)).toBe(false);
	});

	it('handles a note absent from the graph entirely', () => {
		const { app } = vault({});
		expect(hasPathTo(note('A.md'), note('B.md'), app)).toBe(false);
	});

	describe('termination', () => {
		// The stated non-functional requirement: cone computation always terminates
		// on any graph, cyclic or not, halting at the first already-visited note.

		it('terminates on a cycle rather than looping forever', () => {
			const { app } = vault({ 'A.md': ['B.md'], 'B.md': ['C.md'], 'C.md': ['A.md'] });
			expect(hasPathTo(note('A.md'), note('Unreachable.md'), app)).toBe(false);
		});

		it('terminates on a self-link', () => {
			const { app } = vault({ 'A.md': ['A.md'] });
			expect(hasPathTo(note('A.md'), note('B.md'), app)).toBe(false);
		});

		it('still finds a target that lies on a cycle', () => {
			const { app } = vault({ 'A.md': ['B.md'], 'B.md': ['C.md'], 'C.md': ['B.md'] });
			expect(hasPathTo(note('A.md'), note('C.md'), app)).toBe(true);
		});

		it('consults each note at most once, even when many notes link to it', () => {
			// A hub every note links to: without a visited set the hub would be
			// looked up once per inbound edge instead of once.
			const { app, lookups } = vault({
				'A.md': ['Hub.md'],
				'B.md': ['Hub.md'],
				'C.md': ['Hub.md'],
				'Root.md': ['A.md', 'B.md', 'C.md'],
				'Hub.md': ['Leaf.md'],
			});
			expect(hasPathTo(note('Root.md'), note('Nowhere.md'), app)).toBe(false);
			// Six notes are reached and so consulted once each: Root, A, B, C, Hub,
			// and Leaf (looked up, found absent). Hub is reached by three separate
			// edges but must still be consulted only once.
			expect(lookups()).toBe(6);
		});
	});

	describe('composition cone', () => {
		// How HasPathToView actually uses this: given the active note, keep every
		// entry that transitively reaches it. The fixture includes a "shortcut" -
		// Plugin links straight to Graph as well as reaching it through Cone.
		const links = {
			'Plugin.md': ['Cone.md', 'Graph.md'],
			'Cone.md': ['Graph.md'],
			'Graph.md': ['Set.md'],
			'Unrelated.md': ['Other.md'],
		};
		const all = ['Plugin.md', 'Cone.md', 'Graph.md', 'Set.md', 'Unrelated.md', 'Other.md'];
		// Each entry gets its own walk, exactly as the view does it.
		const coneOf = (target: string) =>
			all.filter((p) => hasPathTo(note(p), note(target), vault(links).app));

		it('collects every note that reaches the target, at any depth', () => {
			expect(coneOf('Set.md')).toEqual(['Plugin.md', 'Cone.md', 'Graph.md', 'Set.md']);
		});

		it('excludes notes the target reaches but that do not reach it', () => {
			expect(coneOf('Plugin.md')).toEqual(['Plugin.md']);
		});

		it('leaves disconnected notes out', () => {
			expect(coneOf('Graph.md')).not.toContain('Unrelated.md');
		});
	});

	describe('scale', () => {
		it('walks a long chain without blowing the stack', () => {
			const links: Record<string, string[]> = {};
			for (let i = 0; i < 10_000; i++) links[`n${i}.md`] = [`n${i + 1}.md`];
			const { app } = vault(links);
			expect(hasPathTo(note('n0.md'), note('n10000.md'), app)).toBe(true);
		});
	});
});
