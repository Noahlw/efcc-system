/**
 * Canonical matching key for a full Chinese name.
 *
 * Rules (Slice 1, confirmed): trim surrounding whitespace, map full-width
 * characters and spaces to their half-width forms, collapse internal
 * whitespace, and compare Latin letters case-insensitively. Traditional and
 * Simplified forms are different characters and therefore stay distinct.
 * The original display form is never modified.
 */
export const canonicalNameKey = (fullName: string): string =>
  fullName.normalize("NFKC").trim().replaceAll(/\s+/gu, " ").toLowerCase();
