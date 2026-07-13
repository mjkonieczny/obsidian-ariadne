import { BasesView, MarkdownView, QueryController, TFile, debounce, getAllTags } from 'obsidian';
import { ConeEntry, Direction, coneFrom } from '../graph/cone';
import { VaultGraph } from '../graph/VaultGraph';

/**
 * Lists the active note's cone, in dependency order.
 *
 * The direction decides which cone: down the links for the source cone - what
 * the note depends on, and so what has to be read first - or up them for the
 * composition cone, everything that depends on the note.
 */
export class ConeView extends BasesView {
	readonly type: string;
	private containerEl: HTMLElement;
	private direction: Direction;
	private graph: VaultGraph;

	/**
	 * What the last listing was drawn from.
	 *
	 * Both of the things that call for a redraw fire far more often than the
	 * listing actually changes: `active-leaf-change` fires for sidebars and for
	 * leaves that are not notes at all, and Bases calls `onDataUpdated` on every
	 * keystroke that touches the metadata cache. If none of the inputs moved, the
	 * listing cannot have moved either, and redrawing it is pure cost.
	 */
	private drawn: string | null = null;

	/**
	 * Renders are coalesced: a burst of events should cost one listing, not one
	 * each. `debounce` with a trailing call means the last event in the burst is
	 * the one that draws, so the listing still ends up current.
	 */
	private readonly schedule = debounce(() => this.render(), 50, false);

	constructor(
		controller: QueryController,
		containerEl: HTMLElement,
		type: string,
		direction: Direction,
		graph: VaultGraph,
	) {
		super(controller);
		this.containerEl = containerEl;
		this.type = type;
		this.direction = direction;
		this.graph = graph;
	}

	onload() {
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => this.schedule())
		);
		this.render();
	}

	onDataUpdated() {
		this.schedule();
	}

	/**
	 * Is this view still on screen?
	 *
	 * Bases does not reliably unload a custom view whose leaf has gone - the view
	 * keeps its `active-leaf-change` subscription and goes on being called, with a
	 * container that is no longer in the document. Left alone it would compute a
	 * full cone and build the whole listing into nothing, on every note switch, for
	 * the rest of the session; and one such ghost is added every time a view is
	 * discarded. A detached container is the tell, and it is the one signal that
	 * does not depend on Bases telling us the truth.
	 */
	private alive(): boolean {
		return this.containerEl.isConnected;
	}

	/**
	 * The base's eligible rows, or null when there are none to be had.
	 *
	 * Two different absences land here. Bases may not have run its query yet; or
	 * the view may be inside a note embed, where Bases constructs the view and
	 * loads it but never calls `onDataUpdated` at all - so `this.data` stays
	 * undefined forever. Reading it is not even safe: once the view's leaf is
	 * detached the getter reaches through a controller that is gone and throws.
	 *
	 * So the cone must be able to render without this. It can: the graph comes
	 * from `resolvedLinks` and the origin from the host note, neither of which
	 * needs Bases. What is lost without rows is only the base's own filters, so
	 * this view carries its own - see `matches` - which work either way.
	 */
	private rows(): { file: TFile }[] | null {
		try {
			return this.data?.data ?? null;
		} catch {
			return null;
		}
	}

	private getContextFile(): TFile | null {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view as MarkdownView;
			if (view.containerEl.contains(this.containerEl)) return view.file;
		}
		return this.app.workspace.getActiveFile();
	}

	private option(key: string): string {
		const value = this.config?.get(key);
		return value == null ? '' : String(value).trim();
	}

	private maxHop(): number {
		const configured = Number(this.config?.get('maxHop'));
		return Number.isFinite(configured) && configured > 0 ? configured : Infinity;
	}

	/**
	 * Does the note pass this view's own filters?
	 *
	 * These are the view's, not the base's, and that is deliberate: a base filter
	 * is evaluated by Bases, and Bases hands a custom view nothing inside an
	 * embed. A filter declared here is evaluated here, so it holds in a tab and in
	 * an embed alike.
	 */
	private passes(file: TFile, tag: string, property: string): boolean {
		if (tag) {
			const cache = this.app.metadataCache.getFileCache(file);
			const tags = cache ? (getAllTags(cache) ?? []) : [];
			const wanted = tag.startsWith('#') ? tag : `#${tag}`;
			if (!tags.some((t) => t.toLowerCase() === wanted.toLowerCase())) return false;
		}

		if (property) {
			const parts = property.split('=');
			const name = (parts[0] ?? '').trim();
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
			const actual = frontmatter[name];
			if (parts.length === 1) {
				// bare name: the note need only carry the property
				if (actual === undefined) return false;
			} else if (String(actual) !== parts.slice(1).join('=').trim()) {
				return false;
			}
		}

		return true;
	}

	private matches(ordered: ConeEntry[]): { entry: ConeEntry; file: TFile }[] {
		const tag = this.option('tag');
		const property = this.option('property');
		const rows = this.rows();

		// When Bases has given us rows, they decide eligibility too - so the base's
		// own filters still count wherever Bases actually runs them.
		const eligible = rows ? new Map(rows.map((r) => [r.file.path, r.file])) : null;

		const out: { entry: ConeEntry; file: TFile }[] = [];
		for (const entry of ordered) {
			const file = eligible
				? eligible.get(entry.path)
				: (this.app.vault.getAbstractFileByPath(entry.path) as TFile | null);
			if (!file) continue;
			if (!this.passes(file, tag, property)) continue;
			out.push({ entry, file });
		}
		return out;
	}

	private render() {
		if (!this.alive()) return;

		const target = this.getContextFile();

		// Everything the listing depends on. Same inputs, same listing.
		const key = [
			target?.path ?? '',
			this.direction,
			this.maxHop(),
			this.option('tag'),
			this.option('property'),
			this.graph.generation,
			this.rows()?.length ?? -1,
		].join('\u0000');
		if (key === this.drawn) return;
		this.drawn = key;

		this.containerEl.empty();

		if (!target) {
			this.containerEl.createEl('p', { text: 'No active file.' });
			return;
		}

		const ordered = coneFrom(this.graph.walk(this.direction), target.path, this.maxHop());
		const matches = this.matches(ordered);

		if (matches.length === 0) {
			const empty = this.direction === 'source'
				? 'This note links to nothing.'
				: 'No notes link to this one.';
			this.containerEl.createEl('p', { text: empty });
			return;
		}

		// The entries arrive sorted by layer, so grouping is just chunking. A layer
		// is a set whose members cannot reach one another, so the order inside a
		// group carries no meaning - and a group rests only on the groups below it.
		const counts = new Map<number, number>();
		for (const { entry } of matches) counts.set(entry.layer, (counts.get(entry.layer) ?? 0) + 1);

		let currentLayer: number | null = null;
		let list: HTMLElement | null = null;

		for (const { entry, file } of matches) {
			if (entry.layer !== currentLayer) {
				currentLayer = entry.layer;
				const count = counts.get(currentLayer) ?? 0;
				const heading = this.containerEl.createEl('div', { cls: 'ariadne-layer-heading' });
				heading.createEl('span', {
					text: `Layer ${currentLayer}`,
					cls: 'ariadne-layer',
					attr: { title: 'The longest route from this note - and the sort order' },
				});
				heading.createEl('span', { text: ` ${count}`, cls: 'ariadne-layer-count' });
				list = this.containerEl.createEl('ul');
			}

			const item = list!.createEl('li');
			item.createEl('a', { text: file.basename, href: entry.path });
			// Hop stays on the note: it is how far away it is, which the layer does
			// not say. A note can be one hop out and sit in the deepest layer.
			item.createEl('span', {
				text: ` ${entry.hop}`,
				cls: 'ariadne-hop',
				attr: { title: 'Hops from this note - the shortest route' },
			});
		}
	}
}
