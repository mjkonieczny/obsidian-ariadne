// The graph library ships no types, and its package.json `main` points at an
// index.js that does not exist - hence the deep import of the source.
declare module 'thezeus/src/graph' {
	export interface Edge {
		from: string;
		to: string;
		type: 'directed' | 'undirected';
	}

	export interface Graph {
		V: string[];
		E: number[];
		phi: Record<number, Edge>;
	}

	export interface DecoratedGraph {
		depthFirstOrder(): { pre: string[]; post: string[]; reversePost: string[] };
		cycles(): { hasCycle: boolean; cycle: string[] | null };
		topological(): { isDag: boolean; order: string[] | null };
	}

	export default function decorateGraph(graph: Graph): DecoratedGraph;
}
