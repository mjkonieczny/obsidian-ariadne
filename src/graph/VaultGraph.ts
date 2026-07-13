import { App, Plugin } from 'obsidian';
import { Direction, Walk, forward, invert } from './cone';

/**
 * The vault's link graph, built once and shared by every cone view.
 *
 * Turning `resolvedLinks` into an adjacency map is a pass over every note in the
 * vault, and inverting it is another. That is affordable once. It is not
 * affordable once per view per note switch, which is what each view was doing:
 * the cone of a note costs a few milliseconds, but the two passes in front of it
 * cost more than the cone itself, and they were paid again for every view on
 * screen every time the active note changed or a keystroke landed.
 *
 * So it is cached, and the cache is dropped the moment Obsidian re-resolves the
 * links. It can never answer from a stale graph: `resolvedLinks` changing is
 * exactly the event that clears it.
 *
 * The inverted walk is built on demand. A vault with no composition cone open
 * never pays for one.
 */
export class VaultGraph {
	private app: App;
	private source: Walk | null = null;
	private composition: Walk | null = null;

	/**
	 * Bumped whenever the graph is dropped.
	 *
	 * A view uses it to tell a render that would produce the same listing from one
	 * that would not - see `ConeView.render`.
	 */
	generation = 0;

	constructor(app: App) {
		this.app = app;
	}

	/** Watch for anything that can change a link, and drop the graph when it does. */
	watch(plugin: Plugin): void {
		const drop = () => this.invalidate();
		plugin.registerEvent(this.app.metadataCache.on('resolved', drop));
		plugin.registerEvent(this.app.metadataCache.on('changed', drop));
		plugin.registerEvent(this.app.vault.on('rename', drop));
		plugin.registerEvent(this.app.vault.on('delete', drop));
	}

	invalidate(): void {
		this.source = null;
		this.composition = null;
		this.generation++;
	}

	walk(direction: Direction): Walk {
		if (!this.source) this.source = forward(this.app.metadataCache.resolvedLinks);
		if (direction === 'source') return this.source;

		if (!this.composition) this.composition = invert(this.source);
		return this.composition;
	}
}
