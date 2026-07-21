import { TFile } from 'obsidian';
import { ConeMatch, ConeView } from './ConeView';
import { coneEdges } from '../graph/cone';
import { LayoutNode, layout } from '../graph/layout';

/**
 * The drawing's grid, in pixels of user space.
 *
 * Notes are boxes of a fixed size rather than boxes that fit their titles: a row
 * of ragged boxes is harder to scan than a row of even ones, and a fixed width
 * is what lets the columns line up between rows so a link reads as vertical.
 */
const NODE_W = 128;
const NODE_H = 24;
const COL_GAP = 16;
const ROW_GAP = 44;
const PAD = 24;

/** Roughly what one character costs at the label's size - enough to truncate by. */
const CHAR_W = 6.6;

/** How far the drawing may be zoomed, as a multiple of the whole cone on screen. */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

/** A drag this small is a click that wobbled, not a pan. */
const DRAG_SLOP = 4;

/**
 * Draws the active note's cone as a graph.
 *
 * The same cone as `ConeView`, computed the same way and filtered by the same
 * options - only put on screen as what it actually is. A listing can say what a
 * note rests on and in what order; it cannot say *which* note rests on which,
 * and past a few dozen notes that is most of what there is to know.
 *
 * The rows are the cone's own layers, so the drawing needs no arrowheads: every
 * link steps strictly downward, and reading down the page is reading from the
 * note towards what it is built from.
 */
export class ConeGraphView extends ConeView {
	protected draw(matches: ConeMatch[], origin: TFile): void {
		// The origin is the apex. The listing leaves it out - it is the note you are
		// already looking at - but a drawing cannot: without it the notes it links to
		// have nothing above them, and its links have nowhere to start.
		//
		// `Math.max(1, ...)` only ever bites on a cyclic graph, where the origin can
		// pick up a layer of its own. Keeping it alone on row 0 costs nothing when
		// the graph is acyclic and keeps the drawing rooted when it is not.
		const entries = [
			{ path: origin.path, layer: 0 },
			...matches.map(({ entry }) => ({ path: entry.path, layer: Math.max(1, entry.layer) })),
		];
		const paths = entries.map((e) => e.path);
		const edges = coneEdges(this.graph.walk(this.direction), paths);
		const placed = layout(entries, edges);

		const label = new Map<string, string>([[origin.path, origin.basename]]);
		for (const { entry, file } of matches) label.set(entry.path, file.basename);

		const contentW = Math.max(1, placed.width) * (NODE_W + COL_GAP) - COL_GAP;
		const contentH = Math.max(1, placed.height) * (NODE_H + ROW_GAP) - ROW_GAP;

		// Rows are centred against the widest one, so the drawing hangs symmetrically
		// from the origin instead of being pinned to the left edge.
		const perRow = new Map<number, number>();
		for (const node of placed.nodes) perRow.set(node.row, (perRow.get(node.row) ?? 0) + 1);
		const at = (node: LayoutNode) => {
			const width = (perRow.get(node.row) ?? 1) * (NODE_W + COL_GAP) - COL_GAP;
			return {
				x: (contentW - width) / 2 + node.column * (NODE_W + COL_GAP),
				y: node.row * (NODE_H + ROW_GAP),
			};
		};
		const position = new Map(placed.nodes.map((node) => [node.path, at(node)]));

		const svg = this.containerEl.createSvg('svg', { cls: 'ariadne-graph' });
		svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

		// Links first, so a link never draws over the note it points at.
		const wires = svg.createSvg('g', { cls: 'ariadne-graph-edges' });
		for (const { from, to } of edges) {
			const a = position.get(from);
			const b = position.get(to);
			if (!a || !b) continue;
			const x1 = a.x + NODE_W / 2;
			const y1 = a.y + NODE_H;
			const x2 = b.x + NODE_W / 2;
			const y2 = b.y;
			// A curve rather than a straight line: a link that skips rows would
			// otherwise cut clean through whatever notes lie between them, and the
			// bend makes it visibly a link that passes rather than one that lands.
			const bend = Math.max(ROW_GAP / 2, (y2 - y1) / 3);
			wires.createSvg('path', {
				attr: { d: `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}` },
			});
		}

		const fit = (text: string) => {
			const max = Math.max(1, Math.floor((NODE_W - 12) / CHAR_W));
			return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
		};

		let dragged = false;
		for (const node of placed.nodes) {
			const { x, y } = position.get(node.path)!;
			const name = label.get(node.path) ?? node.path;
			const isOrigin = node.path === origin.path;
			const group = svg.createSvg('g', {
				cls: isOrigin ? 'ariadne-graph-node is-origin' : 'ariadne-graph-node',
			});
			group.createSvg('rect', {
				attr: { x, y, width: NODE_W, height: NODE_H, rx: 5 },
			});
			group.createSvg(
				'text',
				{ attr: { x: x + NODE_W / 2, y: y + NODE_H / 2 } },
				(el) => { el.textContent = fit(name); },
			);
			// The label is truncated to keep the boxes even, so the full title has to
			// stay reachable somewhere.
			group.createSvg('title', {}, (el) => { el.textContent = name; });
			group.addEventListener('click', (event) => {
				// A pan that ended on a note is not a request to open it.
				if (dragged) return;
				void this.app.workspace.openLinkText(
					node.path,
					origin.path,
					event.ctrlKey || event.metaKey,
				);
			});
		}

		// Pan and zoom move the viewBox rather than the contents: one attribute, no
		// re-layout, and the whole drawing stays in the coordinates it was laid out
		// in. Both listeners hang off the `svg` element itself, which is discarded
		// and rebuilt on every render, so they go with it.
		const view = { x: -PAD, y: -PAD, w: contentW + 2 * PAD, h: contentH + 2 * PAD };
		const full = view.w;
		const apply = () => svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
		apply();

		svg.addEventListener('wheel', (event: WheelEvent) => {
			event.preventDefault();
			const rect = svg.getBoundingClientRect();
			if (!rect.width || !rect.height) return;
			const scale = Math.exp(event.deltaY * 0.001);
			const w = Math.min(full / MIN_ZOOM, Math.max(full / MAX_ZOOM, view.w * scale));
			const ratio = w / view.w;
			// Zoom about the pointer, so the note under the cursor stays under it.
			const fx = (event.clientX - rect.left) / rect.width;
			const fy = (event.clientY - rect.top) / rect.height;
			view.x += view.w * (1 - ratio) * fx;
			view.y += view.h * (1 - ratio) * fy;
			view.w = w;
			view.h *= ratio;
			apply();
		});

		let from: { x: number; y: number } | null = null;
		svg.addEventListener('pointerdown', (event: PointerEvent) => {
			from = { x: event.clientX, y: event.clientY };
			dragged = false;
			svg.setPointerCapture(event.pointerId);
		});
		svg.addEventListener('pointermove', (event: PointerEvent) => {
			if (!from) return;
			const rect = svg.getBoundingClientRect();
			if (!rect.width || !rect.height) return;
			const dx = event.clientX - from.x;
			const dy = event.clientY - from.y;
			if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) dragged = true;
			view.x -= (dx * view.w) / rect.width;
			view.y -= (dy * view.h) / rect.height;
			from = { x: event.clientX, y: event.clientY };
			apply();
		});
		const release = (event: PointerEvent) => {
			from = null;
			svg.releasePointerCapture(event.pointerId);
		};
		svg.addEventListener('pointerup', release);
		svg.addEventListener('pointercancel', release);
	}
}
