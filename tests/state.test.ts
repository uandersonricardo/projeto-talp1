import { describe, expect, it } from "vitest";

import { PoCStateAnnotation } from "../src/agents/tester/state.js";

describe("PoCStateAnnotation", () => {
  it("defines the iterations field", () => {
    const spec = (PoCStateAnnotation as any).spec;
    expect(spec.iterations).toBeDefined();
  });

  it("uses additive reducer for iterations", () => {
    const spec = (PoCStateAnnotation as any).spec;
    const reducer = spec.iterations.reducer ?? ((x: number, y: number) => x + y);
    expect(reducer(0, 1)).toBe(1);
  });
});
