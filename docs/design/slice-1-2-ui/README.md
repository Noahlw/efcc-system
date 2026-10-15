# R11 Design Book

The runnable synthetic reference preserves the 40 screen/subflow and 306 fixture states accepted under [#30 Revision 11](https://github.com/Noahlw/efcc-system/issues/30). It defines visual/interaction intent; it does not exercise production auth, D1 or application services.

From this directory:

```sh
node screenbook/serve.mjs
node screenbook/check.mjs
```

Open the printed local URL. [The Book](screenbook/index.html) offers phone/tablet/desktop fixtures and text enlargement; [overview](screenbook/gallery.html) links the primary references. `screenbook/captures/` contains the original phone/desktop reference images. The renderer, CSS, synthetic fixture inputs and required icon assets remain together under `screenbook/`; [Lucide license](screenbook/assets/LUCIDE-LICENSE) remains with its icons.

The check validates fixture headings, destinations, assets and critical design boundaries, including unverified-authentication navigation. Production behavior is qualified through [the testing workflow](../../testing.md).

Accepted PR #47 visual comparisons and historical design/review evidence remain accessible in [PR #47](https://github.com/Noahlw/efcc-system/pull/47) and its linked issues, with immutable source/image links. Historical packets are recoverable from Git history; they are not a second current specification or ownership registry.

The owner-confirmed Revision 11, selected second visual direction and task-focused mobile navigation remain the design authority under [#30](https://github.com/Noahlw/efcc-system/issues/30). The 306 states share outcome templates; they are not 306 independently captured layouts. All 40 primary screens retain their original phone/desktop references.

Historical [accepted decisions](https://github.com/Noahlw/efcc-system/blob/40e64b255a541e4e859c334433b4128496ab2d5a/docs/design/slice-1-2-ui/understanding.md), [prototype report](https://github.com/Noahlw/efcc-system/blob/40e64b255a541e4e859c334433b4128496ab2d5a/docs/design/slice-1-2-ui/qualification.md) and [authentication-unavailable responsive evidence](https://github.com/Noahlw/efcc-system/blob/40e64b255a541e4e859c334433b4128496ab2d5a/docs/design/slice-1-2-ui/verification/responsive.json) preserve the synthetic reference's findings against the Slice 1–2 baseline `100bde8`. They do not qualify current production auth, D1, authorization or reconciliation persistence. Current implementation qualification belongs to [#85](https://github.com/Noahlw/efcc-system/issues/85).
