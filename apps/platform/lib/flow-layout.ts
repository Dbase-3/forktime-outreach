// Lays a flow's step tree out as a picture: boxes top to bottom, a decision
// splitting into two lanes that join again at the next step. Pure, so the
// canvas only draws what this returns.

import { TOP, type Container } from "@outreach/core/flow-tree";
import type { Step } from "@outreach/core/types";

export const NODE_W = 248;
export const NODE_H = 104;
export const PILL_W = 132; // start / end pills
export const PILL_H = 36;
const GAP_Y = 56; // between steps
const GAP_LANES = 96; // decision → its lanes (room for the Yes / Otherwise labels)
const GAP_X = 40; // between lanes
const EMPTY_LANE_W = 150;

export interface InsertAt {
  container: Container;
  index: number;
}

export interface LayoutNode {
  id: string;
  kind: "start" | "end" | "step" | "empty"; // "empty" = a lane with no steps yet
  step?: Step;
  insert?: InsertAt; // for "empty": where its first step goes
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
  label?: "Yes" | "Otherwise";
  insert: InsertAt; // where a step added on this line goes
}

export interface FlowLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

/** A line waiting for the box that comes next. */
interface Exit {
  from: string;
  label?: LayoutEdge["label"];
  insert: InsertAt;
}

interface Block {
  width: number;
  height: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  entry: string | null;
  exits: Exit[];
}

const EMPTY: Block = { width: 0, height: 0, nodes: [], edges: [], entry: null, exits: [] };

function shift(nodes: LayoutNode[], dx: number, dy: number): LayoutNode[] {
  return nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }));
}

function connect(exits: Exit[], to: string): LayoutEdge[] {
  return exits.map((e) => ({ from: e.from, to, label: e.label, insert: e.insert }));
}

function layoutStep(step: Step, container: Container, index: number): Block {
  const after: InsertAt = { container, index: index + 1 };
  if (step.kind !== "branch") {
    const node: LayoutNode = { id: step.id, kind: "step", step, x: 0, y: 0, w: NODE_W, h: NODE_H };
    return { width: NODE_W, height: NODE_H, nodes: [node], edges: [], entry: step.id, exits: step.kind === "end" ? [] : [{ from: step.id, insert: after }] };
  }

  const sides = (["yes", "no"] as const).map((side) => {
    const label = side === "yes" ? ("Yes" as const) : ("Otherwise" as const);
    const insert: InsertAt = { container: { branchId: step.id, side }, index: 0 };
    const list = side === "yes" ? step.yes : step.no;
    const block = list.length > 0 ? layoutList(list, insert.container) : emptyLane(`${step.id}:${side}`, insert);
    return { side, label, block, width: block.width, insert };
  });
  const [yes, no] = sides;
  const lanesWidth = yes.width + GAP_X + no.width;
  const width = Math.max(NODE_W, lanesWidth);
  const lanesX = (width - lanesWidth) / 2;
  const lanesY = NODE_H + GAP_LANES;
  const height = lanesY + Math.max(yes.block.height, no.block.height);

  const decision: LayoutNode = { id: step.id, kind: "step", step, x: (width - NODE_W) / 2, y: 0, w: NODE_W, h: NODE_H };
  const nodes = [decision];
  const edges: LayoutEdge[] = [];
  const exits: Exit[] = [];
  sides.forEach((s, i) => {
    const laneX = lanesX + (i === 0 ? 0 : yes.width + GAP_X) + (s.width - s.block.width) / 2;
    nodes.push(...shift(s.block.nodes, laneX, lanesY));
    edges.push(...s.block.edges);
    if (s.block.entry) edges.push({ from: step.id, to: s.block.entry, label: s.label, insert: s.insert });
    exits.push(...s.block.exits);
  });
  return { width, height, nodes, edges, entry: step.id, exits };
}

/** A lane with no steps: a small "add a step" box the line passes through. */
function emptyLane(id: string, insert: InsertAt): Block {
  const node: LayoutNode = { id, kind: "empty", insert, x: 0, y: 0, w: EMPTY_LANE_W, h: PILL_H };
  return { width: EMPTY_LANE_W, height: PILL_H, nodes: [node], edges: [], entry: id, exits: [{ from: id, insert }] };
}

function layoutList(steps: Step[], container: Container): Block {
  if (steps.length === 0) return EMPTY;
  const blocks = steps.map((step, i) => layoutStep(step, container, i));
  const width = Math.max(...blocks.map((b) => b.width));
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  let y = 0;
  let pending: Exit[] = [];
  blocks.forEach((block, i) => {
    nodes.push(...shift(block.nodes, (width - block.width) / 2, y));
    edges.push(...block.edges);
    if (i > 0 && block.entry) edges.push(...connect(pending, block.entry));
    pending = block.exits;
    y += block.height + GAP_Y;
  });
  return { width, height: y - GAP_Y, nodes, edges, entry: blocks[0].entry, exits: pending };
}

/** The whole picture: a Start pill, the steps, and an End pill if any path runs off the bottom. */
export function layoutFlow(steps: Step[]): FlowLayout {
  const body = layoutList(steps, TOP);
  const width = Math.max(NODE_W, body.width);
  const start: LayoutNode = { id: "start", kind: "start", x: (width - PILL_W) / 2, y: 0, w: PILL_W, h: PILL_H };
  const bodyY = PILL_H + GAP_Y;
  const nodes = [start, ...shift(body.nodes, (width - body.width) / 2, bodyY)];
  const edges = [...body.edges];
  const startExit: Exit = { from: "start", insert: { container: TOP, index: 0 } };
  if (body.entry) edges.push(...connect([startExit], body.entry));
  const open = body.entry ? body.exits : [startExit];
  let height = body.entry ? bodyY + body.height : PILL_H;
  if (open.length > 0) {
    const endY = height + GAP_Y;
    nodes.push({ id: "end", kind: "end", x: (width - PILL_W) / 2, y: endY, w: PILL_W, h: PILL_H });
    edges.push(...connect(open, "end"));
    height = endY + PILL_H;
  }
  return { nodes, edges, width, height };
}
