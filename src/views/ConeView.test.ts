import { beforeEach, describe, expect, it, vi } from 'vitest';

// `obsidian` is provided by the app at runtime, not installed, so the parts the
// view touches are stubbed. `debounce` is made synchronous: the coalescing is
// Obsidian's to get right, and the test is about what a render costs, not when.
vi.mock('obsidian', () => ({
	BasesView: class {
		app: unknown;
		constructor(_controller: unknown) {}
		registerEvent() {}
	},
	MarkdownView: class {},
	debounce: (fn: () => void) => fn,
	getAllTags: () => [],
}));

import { ConeView } from './ConeView';
import { VaultGraph } from '../graph/VaultGraph';

const note = (v: string) => `Notes/${v}.md`;
const LINKS = {
	[note('A')]: { [note('B')]: 1 },
	[note('B')]: { [note('C')]: 1 },
	[note('C')]: {},
};

/** Just enough element for the view to build a listing into, counting redraws. */
function element(isConnected: boolean, redraws: { n: number }): HTMLElement {
	const el = {
		isConnected,
		empty: () => {
			redraws.n++;
		},
		createEl: () => element(isConnected, { n: 0 }),
	};
	return el as unknown as HTMLElement;
}

/** An app whose `resolvedLinks` counts the passes over the vault. */
function harness(isConnected: boolean) {
	let reads = 0;
	const on = () => ({}) as never;
	const app = {
		metadataCache: {
			get resolvedLinks() {
				reads++;
				return LINKS;
			},
			on,
			getFileCache: () => ({ frontmatter: {} }),
		},
		vault: { on, getAbstractFileByPath: (path: string) => ({ path, basename: path }) },
		workspace: { on, getLeavesOfType: () => [], getActiveFile: () => ({ path: note('A') }) },
	};

	const redraws = { n: 0 };
	const containerEl = element(isConnected, redraws);
	const graph = new VaultGraph(app as never);
	const view = new ConeView({} as never, containerEl, 'source-cone', 'source', graph);
	(view as unknown as { app: unknown }).app = app;

	return { view, graph, reads: () => reads, redraws: () => redraws.n };
}

describe('ConeView', () => {
	beforeEach(() => vi.restoreAllMocks());

	it('a view whose container is detached does no work at all', () => {
		// Bases does not reliably unload a custom view whose leaf has gone: it keeps
		// its subscription and is called forever. Before the guard, each of those
		// ghosts computed a full cone on every note switch, for the rest of the
		// session - and a new ghost appeared every time a view was discarded.
		const { view, reads, redraws } = harness(false);

		view.onDataUpdated();
		view.onDataUpdated();
		view.onDataUpdated();

		expect(reads()).toBe(0);
		expect(redraws()).toBe(0);
	});

	it('a view that is on screen does render', () => {
		const { view, reads, redraws } = harness(true);

		view.onDataUpdated();

		expect(reads()).toBe(1);
		expect(redraws()).toBe(1);
	});

	it('does not redraw when nothing it depends on has changed', () => {
		// `active-leaf-change` fires for sidebars and non-note leaves, and Bases
		// calls `onDataUpdated` on every keystroke that touches the metadata cache.
		// Same inputs, same listing - so the later calls must draw nothing. Counting
		// the graph would not show this: the graph is cached, so it is read once
		// however many times the listing is rebuilt. The redraw is the cost here.
		const { view, redraws } = harness(true);

		view.onDataUpdated();
		view.onDataUpdated();
		view.onDataUpdated();

		expect(redraws()).toBe(1);
	});

	it('does redraw once the links change underneath it', () => {
		const { view, graph, redraws } = harness(true);

		view.onDataUpdated();
		expect(redraws()).toBe(1);

		graph.invalidate();
		view.onDataUpdated();

		expect(redraws()).toBe(2);
	});
});
