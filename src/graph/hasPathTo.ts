import { App, TFile } from 'obsidian';

export function hasPathTo(source: TFile, target: TFile, app: App): boolean {
	const graph = app.metadataCache.resolvedLinks;
	const visited = new Set<string>();
	const queue = [source.path];
	while (queue.length > 0) {
		const node = queue.shift()!;
		if (node === target.path) return true;
		if (visited.has(node)) continue;
		visited.add(node);
		for (const neighbor of Object.keys(graph[node] ?? {}))
			queue.push(neighbor);
	}
	return false;
}
