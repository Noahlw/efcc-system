# EFCC testing foundation — Remote OMP implementation prompt

你係 EFCC System 嘅 testing-platform implementation lead。用廣東話交代進度，保留 English technical terms。今次任務係完整實作已批准嘅 Spec #66 同全部 implementation tickets #67–#85，直接延續 PR #47。你收到並執行本 prompt 時，先開始 implementation；呢份文件嘅發佈本身唔代表 implementation 已開始或驗收通過。

## 1. Authority 同 remote workspace

- Repository：`Noahlw/efcc-system`。
- Parent spec：<https://github.com/Noahlw/efcc-system/issues/66>。
- Existing PR：<https://github.com/Noahlw/efcc-system/pull/47>。
- PR integration branch：`codex/tanstack-query-foundation`。啟動時重新讀 live PR HEAD、issue bodies/comments、native dependencies；唔將本文件記錄嘅 SHA 當永遠最新。
- 讀 repo `AGENTS.md`、`CONTEXT.md`、相關 `docs/adr/`、`docs/agents/issue-tracker.md` 同實際 OMP session 已載入嘅 instructions。GitHub spec/tickets 係 acceptance authority；呢份 prompt 係執行導引，唔用摘要縮減 ticket acceptance。
- 原先「planning only」限制屬歷史 stage；owner 將本 prompt 交畀你執行，即授權 scoped local implementation、正常 local qualification 同必要 disposable synthetic fixtures。Destructive runs 仍依 spec 要先另取 owner 授權；指出具體 store／操作／影響範圍。唔碰 personal／remote D1、live accounts 或 production resources。
- Commit／push、issue progress updates／closure、PR metadata edits 按 owner 對你當次 session 嘅授權執行；唔推論本次交接文件嘅 commit 授權亦授權所有後續 remote writes。Merge／deploy／release 必須另行授權。唔開 replacement PR、唔 force-push published history。
- 上一輪 fixes 同 visual closeout 已獲 owner 接受；舊 PR 文字曾未更新。今次保持已接受產品行為，唔重開 visual scope。

## 2. 先讀 repo 內嘅交接材料

1. `docs/testing-foundation/README.md`：材料角色、candidate baseline 同使用限制。
2. `docs/testing-foundation/SOURCE_OF_TRUTH.md`：完整第一輪 consolidated research handoff。當成 verified research starting point；其中 proposed policies／舊 acceptance／performance statements 要按 live Spec #66 同之後 owner 決定 reconcile。
3. `docs/testing-foundation/ticket-index.md`：#67–#85 同 dependencies 導覽。
4. `docs/testing-foundation/coverage.md`：全部 testing files、candidate files 同 related consumers 嘅 initial ownership map。呢份 snapshot 唔係 scope 上限。
5. `docs/testing-foundation/review-material/candidate-manifest.json` 同 `local-candidate.patch`：本地未 commit candidate 嘅完整 review snapshot。

Remote agent 冇本地 macOS filesystem。所有必要材料用 repo-relative paths；唔依賴 `/Users/...`、另一 agent 嘅 process／store／installed packages／session。候選 patch 係未驗證研究材料，唔係已接受 implementation：先獨立分析 tracked changes 同八個新 files，記錄 delete／rewrite／minimal-keep disposition，唔直接 apply 到 integration branch。真係需要重現某個 experiment，先喺 owned disposable workspace 對 recorded baseline 檢查 patch 相容性，並遵守 destructive-run 授權邊界。

保留 unrelated dirty work；開始前核對 checkout、branch、HEAD、index 同 working tree。發現多人更新，先整合最新 source／contracts，唔 reset／clean／覆寫其他人改動。Local candidate 原件仍由 owner 保存；remote snapshot 冇通過證據。

## 3. 沿用現有 OMP configuration

- 使用 remote session 實際載入嘅 OMP config、instructions、skills 同 callable tools；唔從 macOS 複製 config、credentials 或固定 model IDs。若 remote 使用同步嘅 local OMP config，沿用其 model inheritance 同 profile routing。
- 依 OMP 規則先 scope inline：未定 runtime／module boundary 交 `hard`；已定 API／auth 交 `backend`；race／deadline／durability／schema controls 交 `data`；browser behavior／accessibility 交 `ui`。Research 用 `scout`、independent review 用 `reviewer`，前提係該 session 真係 expose。Unavailable 時用 inline／available general profile，清楚講明限制。
- 只有真正獨立嘅 slices 先 parallel dispatch。每個 child 有明確 files／responsibility ownership、ticket acceptance、verified locators；一個 owner 負責 shared fixture contracts 同 integration。告知 children 唔係獨自工作，唔 revert 他人 edits；reuse child 做 follow-up。唔同時改 shared fixtures／config／impact map。
- 依實際 OMP tool routing 做 narrow graph discovery，核對 project／coverage；graph 缺失或 stale 就用 narrow source fallback，唔假設 candidate 已被 index。Large outputs 用 active Context Mode；current library facts 持續用 Context7 同 pinned/official source。Native API 文件存在唔係 EFCC runtime proof。
- OMP explicit skill invocation 用實際支援嘅 `/skill:name`／`skill://name`，唔假設 Codex `$skill` 或 `functions.*` tools 喺 OMP 存在。唔自行改 agent config 或 reinstall tools 解決已知 unavailable capability。

## 4. 全量 scope 同 native-first ownership

目標係實際減少 EFCC 維護嘅 testing infrastructure。優先成熟、等價嘅 native Wrangler／Playwright／Vitest／TypeScript／Git／pnpm／Husky 能力；合理 migration cost 可以接受。唔因舊 helper 正常運作就永久保留，亦唔只包新 interface。採用後 migrate consumers 並真正刪舊實作。

範圍包括全部現有 tests，spec 內 inline code、fixtures、scenario workers、support files、fast Node／compile／SSR tests、candidate 新 code、tooling scripts、configs、hooks、imports／aliases／reexports、production fixture consumers、types 同 current docs。Inventory snapshot 有 47 current test files、八個 candidate 新 files 同合共 67 mapped source paths；按最新 source 增補，唔以呢啲數字當上限。CF01–CF14 亦唔係上限。

保留 EFCC domain scenarios、independent assertions 同不可缺少嘅 causal controls。只喺必要 native 能力缺口／claim 語義有證據時，保留最小 EFCC adapter；每項寫明 exact claim／gap、責任、限制同 alternatives。Architecture ADR 留歷史同 migration crosswalk；唔建立永久雙重 suite、case registry、scheduler、runtime framework 或 cached-pass service。

Tests/tooling 為主；production construction／DI seam 只容許有必要證據嘅最小調整，保持 business permissions／schema／API contracts／accepted UI behavior。

## 5. Runtime、fixtures 同完整保證

- 首選 Wrangler `createTestHarness` 承擔 lifecycle，Playwright native worker/test fixtures 承擔 resource lifetime。Built app 用真正 emitted vinext config／assets／listen ingress；保留必要 dev hydration lane。先做 V1–V7 真正 EFCC compatibility proof，唔重做已解決 generic API research。
- App 實際 D1 binding 直接供 tests 用 `prepare`／`bind`／`all`／`run`／`batch`；每個新 store 套 original migrations，同時驗 tracking／triggers／SQL semantics／bidirectional visibility。刪 per-query Wrangler CLI、generic SQL wrappers、第二個 proxy／DB owner。
- 每 execution worker 獨立 harness／DB。Ordinary cases 重用 store，各 case 自有 accounts／sessions／rows／limiter identities，fresh native API／browser contexts；migrations 只喺 store 建立時跑。Schema fault／race／global-count／global visibility／last-effective-Admin 等用 dedicated fresh stores／必要 serial sequence。Scenario 中途唔 reset；native teardown 接管，唔造 generic table cleanup。V4 isolation／failure／interrupt proof 成立後普通 cases 預設兩個 workers，可調整。
- Test-only default-export RPC provisioning 用真正 Better Auth credentials 同 EFCC domain prerequisites；same-D1／auth parity 成立後刪 production seed route、seed token／HTTP transport、reset branch／table-clear 同全部 callers。唔 fake hash、造 cookies、公開 Staff bootstrap 或留 production backdoor。
- 普通 authenticated browser setup 用 case-owned account 經真正 production HTTP login，再用 native in-memory `storageState`；auth UI／cookies／CSRF／session-transition claims 保留 browser flow。唔 share sessions／persist auth state／改 negative Origin inputs。
- Arm／held／verified／release 用 native RPC；effects 仍經必要 production ingress。保留 actual effect-instance D1 batch barrier、真正 native verifier 成功後 barrier、schema fault／restore 同 failure release。Public verifier option＋最小 auth-construction seam 取代 private-context patch；同 D1 sidecar 唔代表共享 cached auth instance。
- Production pipeline 接管 fault／clock entry 嘅 guards／headers／error routing；刪 copied guards。唔用 direct handler 代 full ingress；`getExport()` 唔當任意 named-function lookup。
- 保留全部 auth／CSRF／session／actor-target-key、real limiter、D1 atomicity／ABORT／IGNORE、real deadlines／正反 controls、rollback、race、receipts／original-key／lost-response recovery、privacy／secret non-replay 同 resilience claims。Expected effects 保持 independent，唔由 production helper 生成。
- Harness reset 唔係 persistent Worker restart。只喺 native reload/update 證明 execution state 重建、durable effects 保留後取代既有 restart lane；唔新增 controller cold-crash 保證。
- 任一 native assumption fail：停止依賴該假設嘅 retirement，保留已知有效 lane 作明確 temporary fallback，帶 concrete gap／evidence／alternatives 回 review；繼續不依賴該 gap 嘅工作。唔 weaken claims、永久接受 copied guards，亦唔將 blocked retirement 當完成。

## 6. 按 tickets 同 native dependencies 執行到底

逐張讀完整 body/comments 同 acceptance，按 live dependencies 做；下面係導航，唔取代 tracker：

| Ticket | 工作 |
| --- | --- |
| #67 N01 | Built app、actual D1、canonical RPC、resource ownership、V1–V4 |
| #68 N02 | Behavioral accessibility／presentation assertions、native capture/reporting |
| #69 N03 | Access、name sign-in、real rate-limit denial/recovery |
| #70 N04 | Restricted status、session renewal、必要 dev readiness |
| #71 N05 | Home notices／participation、移除 table-reset plumbing |
| #72 N06 | Public application、owned applicant correction／withdraw／resubmit／recovery |
| #73 N07 | Staff decisions、applicant projections、private read-only audit |
| #74 N08 | Own／verified Staff identity、case-owned fixtures |
| #75 N09 | Independent restrictions、last-effective-Admin、races／recovery |
| #76 N10 | Eligible deletion、retained history、original-key recovery |
| #77 N11 | Password／session security、public native verifier barrier |
| #78 N12 | Real execution-time deadlines、actual batch controls |
| #79 N13 | Assisted issuance／recovery／one-time handover |
| #80 N14 | Schema／guard failures 經真正 production pipeline |
| #81 N15 | 完整 R11 cross-feature journeys 同 mobile claims |
| #82 N16 | Staged-tree faithful risk-selected local gate、commands、slim CI |
| #83 N17 | Immutable native build reuse、compiled-test invalidation |
| #84 N18 | 全 repo／candidate／consumer contraction、docs／types 對齊 |
| #85 N19 | Final candidate 完整 clean qualification 同 independent review |

唔完成 N01 pilot 就停，亦唔只 migrate helpers。每張 migration 連同 inline infrastructure、imports 同 aliases 一齊收口；N18 最後核實全部 active consumers。八個 candidate 新 files 逐一 delete／rewrite／minimal keep，唔將 rejected Vite／proxy／serial／offline／auto-full policy 靜默保留。

## 7. Developer workflow、cache、matrix 同 artifacts

- `pnpm test` 保持 fast Node；`test:e2e` 完整 live suite；`test:affected` 預設 branch 對 PR base＋uncommitted；`test:staged` 真 index；`test:qualify` 完整 candidate gates。共用 native fixtures/projects。
- Native tags/projects＋一份小 explicit source-area→feature/risk map。Thin Git coordinator 交 native runners；unknown new／rename／delete path fail closed，補 mapping 或 explicit full staged qualification。Required selection 非空同 classification 要由 native discovery 驗證；唔 silent skip。
- Git index export 到 owned temporary workspace，支援 partial staging；formatting 後 source／policy／scripts／lockfile／pnpm config 同 execution 都來自該 snapshot。Index drift 重驗；唔借 unstaged policy/fixes/dependency tree，唔 custom stash／auto-stage outputs。
- pnpm frozen-lockfile＋prefer-offline 先用本機 store，缺 locked packages 才按 staged registry/config 下載，顯示 bootstrap；failure 阻擋。唔強制 ignore-scripts／offline 造成假 parity。
- 單一 pre-commit：native lint-staged＋fast checks＋risk-selected required subset。Shared auth／DB／harness 按獨立語義邊界選，唔每 feature 一個 happy path。Mobile 按 engine-sensitive claims；bypass 要披露同交付前補齊 qualification，唔另造 pre-push gate。
- GitHub CI 保持 intentionally slim：locked install／check／typecheck／fast Node。唔加 heavy Actions jobs；CI green 唔代表 full local E2E。
- 跨 invocation 只 cache immutable app／auxiliary／test-only Worker builds。優先成熟 provider，按 compatibility 同總維護成本選；唔自製 cache engine。完整 compiled inputs／config／assets／locked toolchain／build env 同 output integrity 驗證；missing／corruption rebuild。Validation identity 分開，required tests 每次重跑。Compiled fixture/control/helper 改動亦 invalidate，唔單凭 tests folder 免 build；DB／cookies／sessions／secrets／pass 唔 cache。
- Full matrix：Chromium 全部 browser journeys；iPhone WebKit＋Pixel Chromium critical auth／review／restriction／recovery、cookies／history／secret／draft／mobile claims；HTTP-only 一次；必要 dev／causal lane 保留。全部 agreed viewport／root-font／overflow／focus／draft／critical-action assertions 始終執行。
- Playwright 接管 screenshots／masks／attachments／reporters。Success PNG explicit opt-in；capture off/on 相同 behavioral assertions。刪 custom gallery／writers／重複 metadata，source identity 由 gate 提供一次。Private failure logs／traces 唔公開；publishable evidence 要原始 bytes 已 masking。
- Architecture-first：維護成本、簡潔、可理解、擴展同效能都係評估標準；owner 已取消 speed benchmark／倍數承諾／雙 OS速度或 full compatibility matrix。唔額外加入呢啲 gates，亦唔宣稱未驗證平台或保證提速。

## 8. 完成條件同交付

每項必要 assertion／fault／recovery claim 都要有新 case／layer／resource／engine disposition 同實際證據，先刪舊 tests。Migration crosswalk 同 decisions 留 ADR／交付記錄；唔維護永久兩套 registry。

CF01–CF14 同其他新發現 custom infrastructure，逐項交代 actual replacement＋deletion、minimal retained seam 或 blocked-with-proof，連全部 consumers／commands／config／types／docs。Evidence 唔係 zero-string grep：歷史 ADR／obsolete API negative tests 可以有 literals，但唔可以有 active legacy owner 或換名延續。

N18 收口後 freeze final candidate identity；對該 candidate 跑 check／typecheck／全部 fast tests／production build／完整 agreed HTTP-browser-dev-causal-presentation qualification，再刷新 staged fidelity／privacy／bootstrap／selection／cache hit-invalidation-corruption／resource teardown 證據。記錄 expected/executed cases/projects、source/base、selection、fail/skip、runtime/toolchain 同 private evidence locators。

Retry 只作診斷，保留首次 failure；修正後 required matrix 要 clean pass。唔 quarantine／waive 新 failure，唔拼不同 SHA 結果。Historical pass、failed candidate experiment、docs/API 存在、mock／PNG 都唔係 final acceptance。

安排 fresh independent source/spec review，交清楚 reviewer scope，同時修正 findings，再按變更刷新 affected evidence。Review 無工具時講明缺口，唔自己扮 independent reviewer。

交付摘要包括：completed tickets／acceptance、final source identity、native ownership／actual deletions、retained seams 同理由、required clean results／review findings、所有 unresolved gaps／bypass／unperformed gates。Pilot 唔係 completion；任何未解 retirement／claim gap 都唔可以標全部完成。

Independent candidate review/disposition 完成後移除 `review-material/local-candidate.patch` 同其 manifest；唔把未接受舊實作永久存成第二套 backup。其他 historical research／coverage／ticket docs 若內容已過時，按 N18 收斂為必要 ADR history 同一份 current workflow，避免長期重複 authority。

持續推進所有已授權工作，唔因规模縮 scope 或每個 routine choice 都問 owner。只有真正未定且影響 guarantees／授權邊界嘅決定先帶具體 evidence 回來。最後清楚區分 implementation、qualification、independent review、owner approval 同 release。
