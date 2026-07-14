import { describe, expect, it } from 'vitest';
import { App, Plugin } from 'obsidian';
import { VaultGraph } from './VaultGraph';
import { cone, coneFrom } from './cone';

const note = (v: string) => `Notes/${v}.md`;

/** A → B, A → C, B → D, C → D. */
const LINKS: Record<string, Record<string, number>> = {
	[note('A')]: { [note('B')]: 1, [note('C')]: 1 },
	[note('B')]: { [note('D')]: 1 },
	[note('C')]: { [note('D')]: 1 },
	[note('D')]: {},
};

/**
 * An app whose `resolvedLinks` counts how many times it is read.
 *
 * Reading it is what triggers the pass over the whole vault, so the count is the
 * thing under test: the graph must be built from it once, not once per cone.
 */
function app(links = LINKS) {
	let reads = 0;
	const handlers: (() => void)[] = [];
	const on = () => {
		return {} as never;
	};
	const metadataCache = {
		get resolvedLinks() {
			reads++;
			return links;
		},
		on,
	};
	const application = {
		metadataCache,
		vault: { on },
	} as unknown as App;
	return { app: application, reads: () => reads, handlers };
}

const plugin = { registerEvent: () => undefined } as unknown as Plugin;

describe('VaultGraph', () => {
	it('reads the vault once, however many cones are asked for', () => {
		const { app: a, reads } = app();
		const graph = new VaultGraph(a);

		for (const origin of ['A', 'B', 'C', 'D']) coneFrom(graph.walk('source'), note(origin));

		expect(reads()).toBe(1);
	});

	it('builds the inverted walk only when a composition cone is asked for', () => {
		const { app: a } = app();
		const graph = new VaultGraph(a);

		const source = graph.walk('source');
		expect(graph.walk('source')).toBe(source); // same object: not rebuilt

		const composition = graph.walk('composition');
		expect(composition).not.toBe(source);
		expect(graph.walk('composition')).toBe(composition);
	});

	it('cannot answer from a stale graph: invalidating drops it', () => {
		const { app: a, reads } = app();
		const graph = new VaultGraph(a);

		graph.walk('source');
		expect(reads()).toBe(1);

		graph.invalidate();
		graph.walk('source');
		expect(reads()).toBe(2);
	});

	it('bumps the generation when it drops, so a view knows to redraw', () => {
		const { app: a } = app();
		const graph = new VaultGraph(a);

		const before = graph.generation;
		graph.invalidate();
		expect(graph.generation).toBeGreaterThan(before);
	});

	it('registers its invalidation on the plugin, not on a view', () => {
		const registered: unknown[] = [];
		const { app: a } = app();
		const graph = new VaultGraph(a);

		graph.watch({ registerEvent: (e: unknown) => registered.push(e) } as unknown as Plugin);

		// resolved, changed, rename, delete
		expect(registered.length).toBe(4);
	});

	it('gives the same cone as building the graph from scratch', () => {
		const { app: a } = app();
		const graph = new VaultGraph(a);

		for (const direction of ['source', 'composition'] as const) {
			for (const origin of ['A', 'B', 'C', 'D']) {
				expect(coneFrom(graph.walk(direction), note(origin))).toEqual(
					cone(LINKS, note(origin), direction),
				);
			}
		}
	});

	it('honours maxHop through the cached walk', () => {
		const { app: a } = app();
		const graph = new VaultGraph(a);

		const all = coneFrom(graph.walk('source'), note('A'));
		const near = coneFrom(graph.walk('source'), note('A'), 1);

		expect(all.map((e) => e.path)).toContain(note('D'));
		expect(near.map((e) => e.path)).not.toContain(note('D'));
	});
});

void plugin;
