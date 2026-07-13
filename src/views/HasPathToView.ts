import { BasesView, MarkdownView, QueryController, TFile } from 'obsidian';
import { cone } from '../graph/cone';

export class HasPathToView extends BasesView {
	readonly type = 'ariadne-has-path-to';
	private containerEl: HTMLElement;

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller);
		this.containerEl = containerEl;
	}

	onload() {
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => this.render())
		);
	}

	onDataUpdated() {
		this.render();
	}

	private getContextFile(): TFile | null {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view as MarkdownView;
			if (view.containerEl.contains(this.containerEl)) return view.file;
		}
		return this.app.workspace.getActiveFile();
	}

	private render() {
		// active-leaf-change can fire before Bases has run its query, so there is
		// no result set to intersect the cone with yet. The next onDataUpdated
		// will render properly.
		if (!this.data) return;

		const target = this.getContextFile();
		this.containerEl.empty();

		if (!target) {
			this.containerEl.createEl('p', { text: 'No active file.' });
			return;
		}

		const ordered = cone(this.app.metadataCache.resolvedLinks, target.path, 'composition');

		// The base's own filters still decide what is eligible; the cone decides
		// which of those are reachable, and in what order.
		const eligible = new Map(this.data.data.map((entry) => [entry.file.path, entry.file]));
		const matches = ordered.filter((entry) => eligible.has(entry.path));

		if (matches.length === 0) {
			this.containerEl.createEl('p', { text: 'No notes link to this one.' });
			return;
		}

		const list = this.containerEl.createEl('ul');
		for (const entry of matches) {
			const item = list.createEl('li');
			item.createEl('a', {
				text: eligible.get(entry.path)!.basename,
				href: entry.path,
			});
			item.createEl('span', {
				text: ` ${entry.hop}`,
				cls: 'ariadne-hop',
			});
		}
	}
}
