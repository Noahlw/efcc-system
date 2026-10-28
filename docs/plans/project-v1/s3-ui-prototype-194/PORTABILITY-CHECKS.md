# Portable bundle checks

These checks apply only to this artifact transport, not to EFCC application/security/native qualification.

- Current and editable HTML retain the accepted c4c69e59… source bytes.
- Inline JavaScript syntax parses.
- Headless Chromium opened 11 intended entry/task fixtures at 390px and 1487px through file:// (22 checks): expected active screens, visible headings, no horizontal page overflow, no script errors and no HTTP dependencies.
- Initial smoke attempts used incorrect route/actor/container expectations and a text-length oracle. Those harness assumptions were corrected against the source without changing prototype HTML; first failures remain private. An initial checksum command also used the wrong working directory; the final check runs from the bundle directory.
- All relative local asset references and original reference-image hashes pass.
- Mac/Safari, physical-device/keyboard/AT behavior and application qualification were not run.
- The existing source-impact guard rejects this new HTML area; it is preserved. This is a transport snapshot, not a merge-ready application candidate.

## Observed fixture screens

| Width | Fixture | Active screen |
| --- | --- | --- |
| 390 | home | home |
| 390 | manage | manage |
| 390 | overview | overview |
| 390 | editor | editor |
| 390 | identity | task |
| 390 | delegation | task |
| 390 | admin | task |
| 390 | stepdown | account |
| 390 | account | account |
| 390 | inbox | inbox |
| 390 | department | workspace |
| 1487 | home | home |
| 1487 | manage | manage |
| 1487 | overview | overview |
| 1487 | editor | editor |
| 1487 | identity | task |
| 1487 | delegation | task |
| 1487 | admin | task |
| 1487 | stepdown | account |
| 1487 | account | account |
| 1487 | inbox | inbox |
| 1487 | department | workspace |
