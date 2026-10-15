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
