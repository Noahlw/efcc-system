# Give UI libraries explicit presentation responsibilities

Status: implemented contract from the accepted foundation design. Current source-specific qualification is recorded in #93 / #106; aggregate qualification, independent review and owner acceptance remain separate.

The foundation programme uses pinned CVA 0.7.1 for actual component variants and Lucide 1.58.0 for matching icon geometry. CSS retains theme values; Base UI and native HTML retain interaction, DOM and accessibility behaviour. This is an explicit consolidation choice rather than a defect claim about the existing typed maps. The added dependencies are accepted in exchange for a consistent recipe interface and upstream ownership of common glyphs.

Preserve current variant names/defaults, Button and form contracts, refs, keyboard/focus behaviour, R11 appearance and icon stroke. Replace the superseded implementations instead of keeping duplicate owners. Keep a documented minimal exception for geometry that cannot match, and preserve Design Book references and licences. Verify computed presentation and relevant interactions before declaring parity. Neither CVA adoption nor icon consolidation is a technical prerequisite for typed form composition.

## Current owners

CVA recipes live in `src/components/ui/button.tsx`, `src/components/page-frame.tsx` and `src/features/account/operation-presentation.tsx`. The semantic registry in `src/components/ui/icon.tsx` delegates matching product glyphs to Lucide; the product icon registry retains no custom geometry exception. Reference Book assets and licences remain separate preserved evidence. Production/native stylesheet discovery is declared once by `src/app/globals.css`; Vite and the credential build no longer rewrite that policy per mode.
