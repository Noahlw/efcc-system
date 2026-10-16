import { describe, expect, it } from "vitest";

import {
  parseStaffSearch,
  staffSearchKey,
} from "../../../src/features/account/staff-search-contract";

describe("Staff display search contract", () => {
  it("uses the same application case mapping without sign-in width or Unicode normalization", () => {
    expect(staffSearchKey("陳Ａİ", "Mixed.Name")).toBe(
      "陳ａi\u0307 mixed.name"
    );
    expect(staffSearchKey("陳Ａ", null)).toBe("陳ａ ");
    expect(parseStaffSearch("  Ａİ  ")).toBe("ａi\u0307");
    expect(parseStaffSearch("%_\\")).toBe("%_\\");
    expect(parseStaffSearch("A")).not.toBe(parseStaffSearch("Ａ"));
    expect(parseStaffSearch("é")).not.toBe(parseStaffSearch("e\u0301"));
  });
  it("counts trimmed Unicode code points before case mapping, without truncation", () => {
    expect(parseStaffSearch(`  ${"𠮷".repeat(100)}  `)).toBe("𠮷".repeat(100));
    expect(() => parseStaffSearch("𠮷".repeat(101))).toThrow("100");
    expect(parseStaffSearch("İ".repeat(100))).toBe("i\u0307".repeat(100));
  });
});
