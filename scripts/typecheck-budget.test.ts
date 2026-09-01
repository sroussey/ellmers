/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  checkAgainstBudget,
  type PackageMeasurement,
  type TypecheckBudget,
} from "./typecheck-budget";

const BUDGET: TypecheckBudget = {
  tolerance: 0.15,
  floor: 50_000,
  slack: 2_000,
  packages: { "providers/tiny": 225, "packages/big": 1_000_000 },
};

function measured(pkg: string, instantiations: number): PackageMeasurement {
  return { pkg, instantiations, checkTimeSeconds: 0.1 };
}

describe("checkAgainstBudget", () => {
  // The case this slack exists for: a 225-instantiation package picking up 74
  // more reads as +33% and used to fail the gate, while saying nothing about
  // the instantiation explosions the guard is built to catch.
  it("does not gate a small package on growth within the absolute slack", () => {
    const { regressions } = checkAgainstBudget([measured("providers/tiny", 299)], BUDGET);
    expect(regressions).toEqual([]);
  });

  it("still gates a small package once growth passes the slack", () => {
    const { regressions } = checkAgainstBudget([measured("providers/tiny", 2_300)], BUDGET);
    expect(regressions).toEqual([{ pkg: "providers/tiny", budget: 225, actual: 2_300 }]);
  });

  it("keeps a large package on the relative tolerance, not the slack", () => {
    // +10k instantiations is five times the slack but only +1%, which is the
    // ordinary drift a big package sees; +20% is the regression.
    expect(checkAgainstBudget([measured("packages/big", 1_010_000)], BUDGET).regressions).toEqual(
      []
    );
    expect(
      checkAgainstBudget([measured("packages/big", 1_200_000)], BUDGET).regressions
    ).toHaveLength(1);
  });

  it("applies the same slack to improvements so small packages stay quiet", () => {
    expect(checkAgainstBudget([measured("providers/tiny", 150)], BUDGET).improvements).toEqual([]);
    expect(
      checkAgainstBudget([measured("packages/big", 700_000)], BUDGET).improvements
    ).toHaveLength(1);
  });

  it("reports an unbudgeted package only once it is worth gating", () => {
    expect(checkAgainstBudget([measured("packages/new", 12_226)], BUDGET).newPackages).toEqual([]);
    expect(checkAgainstBudget([measured("packages/new", 60_000)], BUDGET).newPackages).toEqual([
      { pkg: "packages/new", actual: 60_000 },
    ]);
  });
});
