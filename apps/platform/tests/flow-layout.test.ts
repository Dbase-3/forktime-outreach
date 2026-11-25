import { describe, expect, it } from "vitest";
import { NODE_W, layoutFlow } from "@/lib/flow-layout";
import { TEMPLATES, flowFromTemplate } from "@/lib/templates";
import type { Step } from "@/lib/types";

const say = (id: string): Step => ({ id, kind: "say", text: id });
const end = (id: string): Step => ({ id, kind: "end", outcome: id, text: "bye" });
const branch = (id: string, yes: Step[], no: Step[]): Step => ({ id, kind: "branch", condition: { field: "x", op: "is_yes" }, yes, no });
const edge = (layout: ReturnType<typeof layoutFlow>, from: string, to: string) => layout.edges.find((e) => e.from === from && e.to === to);

describe("layoutFlow", () => {
  it("draws an empty flow as Start → End", () => {
    const layout = layoutFlow([]);
    expect(layout.nodes.map((n) => n.id)).toEqual(["start", "end"]);
    expect(edge(layout, "start", "end")?.insert).toEqual({ container: { branchId: null }, index: 0 });
  });

  it("stacks steps top to bottom and adds End when the last step isn't an ending", () => {
    const layout = layoutFlow([say("a"), say("b")]);
    const [a, b] = ["a", "b"].map((id) => layout.nodes.find((n) => n.id === id)!);
    expect(b.y).toBeGreaterThan(a.y + a.h);
    expect(a.x).toBe(b.x);
    expect(edge(layout, "a", "b")?.insert).toEqual({ container: { branchId: null }, index: 1 });
    expect(edge(layout, "b", "end")).toBeDefined();
  });

  it("does not add End when every path ends", () => {
    expect(layoutFlow([say("a"), end("z")]).nodes.some((n) => n.id === "end")).toBe(false);
  });

  it("splits a decision into two lanes side by side that join at the next step", () => {
    const layout = layoutFlow([branch("d", [say("y1")], [say("n1")]), say("after")]);
    const y1 = layout.nodes.find((n) => n.id === "y1")!;
    const n1 = layout.nodes.find((n) => n.id === "n1")!;
    expect(y1.y).toBe(n1.y);
    expect(y1.x + NODE_W).toBeLessThan(n1.x);
    expect(edge(layout, "d", "y1")).toMatchObject({ label: "Yes", insert: { container: { branchId: "d", side: "yes" }, index: 0 } });
    expect(edge(layout, "d", "n1")).toMatchObject({ label: "Otherwise" });
    expect(edge(layout, "y1", "after")).toBeDefined();
    expect(edge(layout, "n1", "after")).toBeDefined();
  });

  it("routes an empty lane through an 'add a step' box in its own column", () => {
    const layout = layoutFlow([branch("d", [], [say("n1")]), say("after")]);
    const placeholder = layout.nodes.find((n) => n.id === "d:yes")!;
    const n1 = layout.nodes.find((n) => n.id === "n1")!;
    expect(placeholder).toMatchObject({ kind: "empty", insert: { container: { branchId: "d", side: "yes" }, index: 0 } });
    expect(placeholder.x + placeholder.w).toBeLessThan(n1.x);
    expect(edge(layout, "d", "d:yes")).toMatchObject({ label: "Yes" });
    expect(edge(layout, "d:yes", "after")).toBeDefined();
    expect(edge(layout, "d", "after")).toBeUndefined();
  });

  it("a decision with both lanes empty still shows both labels", () => {
    const layout = layoutFlow([branch("d", [], [])]);
    expect(layout.edges.filter((e) => e.from === "d").map((e) => e.label)).toEqual(["Yes", "Otherwise"]);
  });

  it("a lane that ends the call does not join the next step", () => {
    const layout = layoutFlow([branch("d", [end("booked")], [say("n1")]), say("after")]);
    expect(edge(layout, "booked", "after")).toBeUndefined();
    expect(edge(layout, "n1", "after")).toBeDefined();
  });

  it("lays out every template with no overlapping boxes", () => {
    for (const template of TEMPLATES) {
      const { nodes } = layoutFlow(flowFromTemplate(template).steps);
      for (const a of nodes) {
        for (const b of nodes) {
          if (a === b) continue;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${template.id}: ${a.id} overlaps ${b.id}`).toBe(false);
        }
      }
    }
  });
});
