import { Plugin, ViewOption } from 'obsidian';
import { VaultGraph } from './graph/VaultGraph';
import { ConeGraphView } from './views/ConeGraphView';
import { ConeView } from './views/ConeView';

// The composition view keeps its original type id: bases already in the vault
// name it, and a renamed type would silently stop resolving.
const COMPOSITION = 'ariadne-has-path-to';
const SOURCE = 'ariadne-source-cone';
const SOURCE_GRAPH = 'ariadne-source-cone-graph';

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
	// One graph, shared by every view and every note. Building it is a pass over
	// the whole vault; each view doing that for itself is what made switching
	// notes cost more than computing the cones did.
	const graph = new VaultGraph(plugin.app);
	graph.watch(plugin);

	plugin.registerBasesView(SOURCE, {
		name: 'Source cone',
		icon: 'git-branch',
		options,
		factory: (controller, containerEl) =>
			new ConeView(controller, containerEl, SOURCE, 'source', graph),
	});

	// The same cone as the listing above, drawn rather than listed. It shares the
	// listing's options, because it is the same cone answering to the same
	// filters - only the last step differs.
	plugin.registerBasesView(SOURCE_GRAPH, {
		name: 'Source cone graph',
		icon: 'workflow',
		options,
		factory: (controller, containerEl) =>
			new ConeGraphView(controller, containerEl, SOURCE_GRAPH, 'source', graph),
	});

	plugin.registerBasesView(COMPOSITION, {
		name: 'Composition cone',
		icon: 'git-branch-plus',
		options,
		factory: (controller, containerEl) =>
			new ConeView(controller, containerEl, COMPOSITION, 'composition', graph),
	});
}
