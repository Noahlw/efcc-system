/**
 * Canonical matching key for a full Chinese name.
 *
 * Rules (Slice 1, confirmed): trim surrounding whitespace, map full-width
 * ASCII characters and spaces to their half-width forms, and compare Latin
 * letters case-insensitively. Internal whitespace, compatibility characters,
 * and non-Latin case remain distinct. Traditional and
 * Simplified forms are different characters and therefore stay distinct.
 * The original display form is never modified.
 */
export const canonicalNameKey = (fullName: string): string =>
  fullName
    .replaceAll(/[\uFF01-\uFF5E\u3000]/gu, (character) =>
      character === "\u3000"
        ? " "
        : String.fromCodePoint((character.codePointAt(0) ?? 0) - 0xfe_e0)
    )
    .trim()
    .replaceAll(/\p{Script=Latin}/gu, (character) => character.toLowerCase());
