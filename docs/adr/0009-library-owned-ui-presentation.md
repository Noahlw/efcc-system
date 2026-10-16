# Give UI libraries explicit presentation responsibilities

Status: accepted design from the foundation planning interview; implementation pending.

The foundation programme will adopt stable CVA for actual component variants and Lucide for matching icon geometry. CSS retains theme values; Base UI and native HTML retain interaction, DOM and accessibility behaviour. This is an explicit consolidation choice rather than a defect claim about the existing typed maps. The added dependencies are accepted in exchange for a consistent recipe interface and upstream ownership of common glyphs.

Preserve current variant names/defaults, Button and form contracts, refs, keyboard/focus behaviour, R11 appearance and icon stroke. Replace the superseded implementations instead of keeping duplicate owners. Keep a documented minimal exception for geometry that cannot match, and preserve Design Book references and licences. Verify computed presentation and relevant interactions before declaring parity. Neither CVA adoption nor icon consolidation is a technical prerequisite for typed form composition.
