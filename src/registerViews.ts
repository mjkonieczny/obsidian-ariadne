import { Plugin, ViewOption } from 'obsidian';
import { ConeView } from './views/ConeView';

// The composition view keeps its original type id: bases already in the vault
// name it, and a renamed type would silently stop resolving.
const COMPOSITION = 'ariadne-has-path-to';
const SOURCE = 'ariadne-source-cone';

/**
 * The view's own settings, rather than the base's filters.
 *
 * Bases evaluates a base's filters and hands the result to the view - except in
 * a note embed, where it hands a custom view nothing at all. Anything declared
 * here is read straight from the view's config and applied by the view, so it
 * holds in an embed as well as in a tab.
 */
function options(): ViewOption[] {
	return [
		{
			type: 'slider',
			key: 'maxHop',
			displayName: 'Max hops',
			default: 0,
			min: 0,
			max: 10,
			step: 1,
		},
		{
			type: 'text',
			key: 'tag',
			displayName: 'Only notes tagged',
			placeholder: 'research',
		},
		{
			type: 'text',
			key: 'property',
			displayName: 'Only notes where',
			placeholder: 'publish=true',
		},
	];
}

export function registerViews(plugin: Plugin): void {
	plugin.registerBasesView(SOURCE, {
		name: 'Source cone',
		icon: 'git-branch',
		options,
		factory: (controller, containerEl) =>
			new ConeView(controller, containerEl, SOURCE, 'source'),
	});

	plugin.registerBasesView(COMPOSITION, {
		name: 'Composition cone',
		icon: 'git-branch-plus',
		options,
		factory: (controller, containerEl) =>
			new ConeView(controller, containerEl, COMPOSITION, 'composition'),
	});
}
