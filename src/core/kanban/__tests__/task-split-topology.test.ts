import { describe, it, expect } from "vitest";
import {
  topologicalSort,
  detectFileConflicts,
  inferMergeStrategy,
  validateSplitPlan,
  type SubTaskDef,
} from "../task-split-topology";

describe("task-split-topology", () => {
  describe("topologicalSort", () => {
    it("sorts tasks with serial dependencies", () => {
      const tasks: SubTaskDef[] = [
        { ref: "c", title: "C", objective: "" },
        { ref: "a", title: "A", objective: "" },
        { ref: "b", title: "B", objective: "" },
      ];
      const edges: Array<[string, string]> = [
        ["a", "b"],
        ["b", "c"],
      ];

      const sorted = topologicalSort(tasks, edges);

      expect(sorted.map((t) => t.ref)).toEqual(["a", "b", "c"]);
      expect(sorted[0].topoOrder).toBe(0);
      expect(sorted[2].topoOrder).toBe(2);
    });

    it("sorts parallel tasks with no edges", () => {
      const tasks: SubTaskDef[] = [
        { ref: "x", title: "X", objective: "" },
        { ref: "y", title: "Y", objective: "" },
        { ref: "z", title: "Z", objective: "" },
      ];

      const sorted = topologicalSort(tasks, []);

      expect(sorted).toHaveLength(3);
      expect(sorted.map((t) => t.ref).sort()).toEqual(["x", "y", "z"]);
    });

    it("sorts diamond dependency", () => {
      // a → b, a → c, b → d, c → d
      const tasks: SubTaskDef[] = [
        { ref: "a", title: "A", objective: "" },
        { ref: "b", title: "B", objective: "" },
        { ref: "c", title: "C", objective: "" },
        { ref: "d", title: "D", objective: "" },
      ];
      const edges: Array<[string, string]> = [
        ["a", "b"],
        ["a", "c"],
        ["b", "d"],
        ["c", "d"],
      ];

      const sorted = topologicalSort(tasks, edges);
      const order = sorted.map((t) => t.ref);

      expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
      expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
      expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
    });

    it("throws on circular dependency", () => {
      const tasks: SubTaskDef[] = [
        { ref: "a", title: "A", objective: "" },
        { ref: "b", title: "B", objective: "" },
        { ref: "c", title: "C", objective: "" },
      ];
      const edges: Array<[string, string]> = [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ];

      expect(() => topologicalSort(tasks, edges)).toThrow("Circular dependency");
    });

    it("throws on edge referencing unknown task", () => {
      const tasks: SubTaskDef[] = [
        { ref: "a", title: "A", objective: "" },
      ];
      const edges: Array<[string, string]> = [["a", "nonexistent"]];

      expect(() => topologicalSort(tasks, edges)).toThrow("unknown task");
    });
  });

  describe("detectFileConflicts", () => {
    it("detects overlapping file paths", () => {
      const tasks: SubTaskDef[] = [
        { ref: "a", title: "A", objective: "", estimatedFilePaths: ["src/foo.ts", "src/bar.ts"] },
        { ref: "b", title: "B", objective: "", estimatedFilePaths: ["src/foo.ts", "src/baz.ts"] },
      ];

      const conflicts = detectFileConflicts(tasks);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].path).toBe("src/foo.ts");
      expect(conflicts[0].taskRefs).toContain("a");
      expect(conflicts[0].taskRefs).toContain("b");
    });

    it("returns empty when no conflicts", () => {
      const tasks: SubTaskDef[] = [
        { ref: "a", title: "A", objective: "", estimatedFilePaths: ["src/a.ts"] },
        { ref: "b", title: "B", objective: "", estimatedFilePaths: ["src/b.ts"] },
      ];

      expect(detectFileConflicts(tasks)).toHaveLength(0);
    });

    it("handles tasks without estimatedFilePaths", () => {
      const tasks: SubTaskDef[] = [
        { ref: "a", title: "A", objective: "" },
        { ref: "b", title: "B", objective: "" },
      ];

      expect(detectFileConflicts(tasks)).toHaveLength(0);
    });
  });

  describe("inferMergeStrategy", () => {
    it("returns fan_in for parallel tasks (no edges)", () => {
      const tasks: SubTaskDef[] = [
        { ref: "a", title: "A", objective: "" },
        { ref: "b", title: "B", objective: "" },
      ];
      expect(inferMergeStrategy(tasks, [])).toBe("fan_in");
    });

    it("returns cascade for serial chain", () => {
      const tasks: SubTaskDef[] = [
        { ref: "a", title: "A", objective: "" },
        { ref: "b", title: "B", objective: "" },
        { ref: "c", title: "C", objective: "" },
      ];
      const edges: Array<[string, string]> = [["a", "b"], ["b", "c"]];
      expect(inferMergeStrategy(tasks, edges)).toBe("cascade");
    });

    it("returns cascade_fan_in for diamond", () => {
      const tasks: SubTaskDef[] = [
        { ref: "a", title: "A", objective: "" },
        { ref: "b", title: "B", objective: "" },
        { ref: "c", title: "C", objective: "" },
        { ref: "d", title: "D", objective: "" },
      ];
      const edges: Array<[string, string]> = [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]];
      expect(inferMergeStrategy(tasks, edges)).toBe("cascade_fan_in");
    });
  });

  describe("validateSplitPlan", () => {
    it("returns empty for valid plan", () => {
      const tasks: SubTaskDef[] = [
        { ref: "a", title: "A", objective: "" },
        { ref: "b", title: "B", objective: "" },
      ];
      const edges: Array<[string, string]> = [["a", "b"]];
      expect(validateSplitPlan(tasks, edges)).toHaveLength(0);
    });

    it("detects duplicate refs", () => {
      const tasks: SubTaskDef[] = [
        { ref: "a", title: "A", objective: "" },
        { ref: "a", title: "A2", objective: "" },
      ];
      const errors = validateSplitPlan(tasks, []);
      expect(errors.some((e) => e.includes("Duplicate"))).toBe(true);
    });

    it("detects self-dependency", () => {
      const tasks: SubTaskDef[] = [
        { ref: "a", title: "A", objective: "" },
      ];
      const edges: Array<[string, string]> = [["a", "a"]];
      const errors = validateSplitPlan(tasks, edges);
      expect(errors.some((e) => e.includes("Self-dependency"))).toBe(true);
    });
  });
});
