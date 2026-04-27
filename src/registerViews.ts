import { Plugin } from 'obsidian';
import { HasPathToView } from './views/HasPathToView';

export function registerViews(plugin: Plugin): void {
	plugin.registerBasesView('ariadne-has-path-to', {
		name: 'Composition cone',
		icon: 'git-branch-plus',
		factory: (controller, containerEl) =>
			new HasPathToView(controller, containerEl),
	});
}
