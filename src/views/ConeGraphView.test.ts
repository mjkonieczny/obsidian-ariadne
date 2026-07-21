import { describe, expect, it, vi } from 'vitest';

// Same stubs as the listing view's tests: `obsidian` is the app's, not a package,
// and `debounce` is made synchronous so a render can be asserted on directly.
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

import { ConeGraphView } from './ConeGraphView';
import { VaultGraph } from '../graph/VaultGraph';

const note = (v: string) => `Notes/${v}.md`;

// A -> B -> C, and A -> C as well: C is one hop from the origin and still sits
// beneath B, which is the case the layer exists to get right.
const LINKS = {
	[note('A')]: { [note('B')]: 1, [note('C')]: 1 },
	[note('B')]: { [note('C')]: 1 },
	[note('C')]: {},
};

/** Enough of an element to draw into, keeping what was drawn. */
interface Fake {
	tag: string;
	cls: string;
	attrs: Record<string, string>;
	textContent: string;
	children: Fake[];
	listeners: Record<string, ((event: unknown) => void)[]>;
}

/**
 * What Obsidian does with `cls`, including the part that bites.
 *
 * It hands each class to `classList.add`, which rejects a token containing a
 * space outright. A single string naming two classes therefore looks perfectly
 * reasonable, passes any stub that just stores it, and throws in the app - and
 * because the throw lands mid-draw, what is left on screen is whatever had
 * already been drawn. So the stub has to reproduce the throw, not tolerate it.
 */
function classes(cls: string | string[] | undefined): string {
	const tokens = cls === undefined ? [] : Array.isArray(cls) ? cls : [cls];
	for (const token of tokens) {
		if (/\s/.test(token)) throw new Error(`InvalidCharacterError: '${token}' has a space`);
	}
	return tokens.join(' ');
}

function fake(tag: string, cls = ''): Fake {
	const el: Fake = { tag, cls, attrs: {}, textContent: '', children: [], listeners: {} };
	const make = (childTag: string, o?: { attr?: Record<string, unknown>; cls?: string | string[]; text?: string }, cb?: (el: unknown) => void) => {
		const child = fake(childTag, classes(o?.cls));
		for (const [k, v] of Object.entries(o?.attr ?? {})) child.attrs[k] = String(v);
		if (o?.text) child.textContent = o.text;
		el.children.push(child);
		cb?.(child);
		return child;
	};
	return Object.assign(el, {
		isConnected: true,
		empty: () => {
			el.children.length = 0;
		},
		createEl: make,
		createSvg: make,
		setAttribute: (k: string, v: string) => {
			el.attrs[k] = v;
		},
		addEventListener: (name: string, fn: (event: unknown) => void) => {
			(el.listeners[name] ??= []).push(fn);
		},
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
		setPointerCapture: () => {},
		releasePointerCapture: () => {},
	});
}

/** Everything drawn, at any depth. */
function all(el: Fake): Fake[] {
	return el.children.flatMap((child) => [child, ...all(child)]);
}

const withClass = (el: Fake, cls: string) => all(el).filter((e) => e.cls.includes(cls));

function harness() {
	const opened: unknown[][] = [];
	const on = () => ({}) as never;
	const app = {
		metadataCache: {
			resolvedLinks: LINKS,
			on,
			getFileCache: () => ({ frontmatter: {} }),
		},
		vault: {
			on,
			getAbstractFileByPath: (path: string) => ({ path, basename: path.replace(/^Notes\/|\.md$/g, '') }),
		},
		workspace: {
			on,
			getLeavesOfType: () => [],
			getActiveFile: () => ({ path: note('A'), basename: 'A' }),
			openLinkText: (...args: unknown[]) => {
				opened.push(args);
				return Promise.resolve();
			},
		},
	};

	const containerEl = fake('div');
	const graph = new VaultGraph(app as never);
	const view = new ConeGraphView(
		{} as never,
		containerEl as unknown as HTMLElement,
		'source-cone-graph',
		'source',
		graph,
	);
	(view as unknown as { app: unknown }).app = app;

	return { view, containerEl, opened };
}

describe('ConeGraphView', () => {
	it('draws a box per note of the cone, and the origin above them', () => {
		// The listing leaves the origin out - it is the note being looked at. A
		// drawing cannot: without it the notes it links to have nothing above them.
		const { view, containerEl } = harness();
		view.onDataUpdated();

		const nodes = withClass(containerEl, 'ariadne-graph-node');
		expect(nodes.map((n) => all(n).find((c) => c.tag === 'title')?.textContent).sort())
			.toEqual(['A', 'B', 'C']);
		expect(nodes.filter((n) => n.cls.includes('is-origin')).length).toBe(1);
	});

	it('marks the origin with a second class rather than a longer one', () => {
		// The regression: `cls: 'ariadne-graph-node is-origin'` throws inside
		// `classList.add`, and the origin is the first node drawn - so the links
		// appeared and not one box did.
		const { view, containerEl } = harness();
		view.onDataUpdated();

		const origin = withClass(containerEl, 'is-origin');
		expect(origin.length).toBe(1);
		expect(origin[0]!.cls).toBe('ariadne-graph-node is-origin');
	});

	it('draws the links among those notes', () => {
		// A->B, A->C and B->C - the cone's induced subgraph, which is the whole
		// point of drawing it rather than listing it.
		const { view, containerEl } = harness();
		view.onDataUpdated();

		const edges = withClass(containerEl, 'ariadne-graph-edges');
		expect(edges.length).toBe(1);
		expect(edges[0]!.children.filter((c) => c.tag === 'path').length).toBe(3);
	});

	it('opens the note when its box is clicked', () => {
		const { view, containerEl, opened } = harness();
		view.onDataUpdated();

		const box = withClass(containerEl, 'ariadne-graph-node')
			.find((n) => all(n).some((c) => c.tag === 'title' && c.textContent === 'C'))!;
		box.listeners.click![0]!({ ctrlKey: false, metaKey: false });

		expect(opened[0]![0]).toBe(note('C'));
	});

	it('gives the drawing a viewBox that fits the whole cone', () => {
		// Without one the SVG has no coordinate system and nothing appears.
		const { view, containerEl } = harness();
		view.onDataUpdated();

		const svg = withClass(containerEl, 'ariadne-graph')[0]!;
		expect(svg.attrs.viewBox).toMatch(/^-?\d+(\.\d+)? -?\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/);
	});

	it('does no work at all when its container is detached', () => {
		// Bases does not reliably unload a custom view whose leaf has gone - the same
		// ghost that the listing view guards against.
		const { view, containerEl } = harness();
		(containerEl as unknown as { isConnected: boolean }).isConnected = false;

		view.onDataUpdated();

		expect(containerEl.children.length).toBe(0);
	});
});
