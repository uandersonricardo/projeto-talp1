import { PoCState } from "../state.js";

export const CATEGORY_REENTRANCY = "REENTRANCY";
export const CATEGORY_ACCESS_CONTROL = "ACCESS_CONTROL";
export const CATEGORY_ARITHMETIC = "ARITHMETIC";
export const CATEGORY_LOGIC = "LOGIC";
export const CATEGORY_DEFAULT = "DEFAULT";

export async function routerNode(state: PoCState): Promise<Partial<PoCState>> {
  console.log("[routerNode] Classifying vulnerability deterministically...");

  const type = (state.report.type || "").toLowerCase();
  const desc = (state.report.description || "").toLowerCase();
  
  const combined = `${type} ${desc}`;

  let category = CATEGORY_DEFAULT;

  if (combined.includes("reentrancy") || combined.includes("re-entrancy") || combined.includes("fallback")) {
    category = CATEGORY_REENTRANCY;
  } else if (combined.includes("access control") || combined.includes("unauthorized") || combined.includes("onlyowner") || combined.includes("permission")) {
    category = CATEGORY_ACCESS_CONTROL;
  } else if (combined.includes("overflow") || combined.includes("underflow") || combined.includes("arithmetic") || combined.includes("math")) {
    category = CATEGORY_ARITHMETIC;
  } else if (combined.includes("logic") || combined.includes("validation") || combined.includes("bypass")) {
    category = CATEGORY_LOGIC;
  }

  console.log(`[routerNode] Classified as: ${category}`);

  return { vulnerabilityCategory: category };
}
