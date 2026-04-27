import { BasesView, MarkdownView, QueryController, TFile } from 'obsidian';
import { hasPathTo } from '../graph/hasPathTo';

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
		const target = this.getContextFile();
		this.containerEl.empty();

		if (!target) {
			this.containerEl.createEl('p', { text: 'No active file.' });
			return;
		}

		const matches = this.data.data.filter(e => hasPathTo(e.file, target, this.app));

		if (matches.length === 0) {
			this.containerEl.createEl('p', { text: 'No notes link to this one.' });
			return;
		}

		const list = this.containerEl.createEl('ul');
		for (const entry of matches) {
			list.createEl('li').createEl('a', {
				text: entry.file.basename,
				href: entry.file.path,
			});
		}
	}
}
