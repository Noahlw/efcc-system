# Domain Docs

This repository uses one EFCC domain context. Feature folders are code ownership boundaries, not separate domain-document contexts.

## Read before domain or structural exploration

- Root `CONTEXT.md`: the domain glossary.
- Relevant documents under root `docs/adr/`: accepted architectural decisions.

If a domain document is missing, proceed silently. Do not create placeholder glossary or ADR files; domain-modeling creates them when terminology or decisions are actually resolved.

## Layout

```text
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   └── agents/
└── src/
```

Keep domain docs at the root. The repository does not use `CONTEXT-MAP.md` or per-feature `CONTEXT.md` files.

## Use the glossary

Use the terms defined in `CONTEXT.md` in issue titles, proposals, tests and code discussions. If a needed concept is absent, distinguish an invented concept from a genuine modeling gap; record genuine gaps for domain-modeling.

## Respect architectural decisions

Read the ADRs relevant to the change. If a proposal conflicts with an accepted ADR, name the ADR and explain the conflict instead of silently overriding it.
