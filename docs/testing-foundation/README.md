# Testing foundation — Remote implementation handoff

呢個 package 令 remote OMP agent 可以直接喺 PR #47 取得 planning authority、research 同本地未 commit candidate review material。發佈呢啲文件唔代表 implementation 已開始、candidate 已接受或 tests 已通過。

## 最新 implementation checkpoint

跨機續做先讀 [HANDOFF.md](HANDOFF.md)，再讀下方完整 execution contract。呢次係未完成 implementation 嘅 checkpoint，唔係 ticket acceptance 或 final qualification；已完成嘅 independent candidate disposition 見 [CANDIDATE_DISPOSITION.md](CANDIDATE_DISPOSITION.md)。

## 開始執行

將以下 prompt 交畀 remote agent：

> Implement the complete EFCC testing-foundation Spec #66 and tickets #67–#85, directly on PR #47. Read `docs/testing-foundation/IMPLEMENTATION_PROMPT.md` in full and follow it. Use the OMP configuration, instructions, profiles and callable tools actually loaded in your remote session. Complete all migrations, native-first cleanup and final qualification; preserve every existing guarantee. Refresh live PR/issue state before edits. Treat the packaged local candidate as unverified review material, not as accepted implementation. Do not merge, deploy, access production data, or perform unapproved destructive runs.

## 文件用途同 authority

| 文件 | 用途 |
| --- | --- |
| [IMPLEMENTATION_PROMPT.md](IMPLEMENTATION_PROMPT.md) | 完整 execution contract，含 OMP routing、whole-repo cleanup、gates 同交付要求 |
| [SOURCE_OF_TRUTH.md](SOURCE_OF_TRUTH.md) | 原 consolidated research handoff，完整保留；舊 proposed decisions 按 live Spec #66 reconcile |
| [ticket-index.md](ticket-index.md) | 已發佈 #67–#85 dependencies 導覽 |
| [coverage.md](coverage.md) | Initial 67-path ownership snapshot；新 paths 同 inline infrastructure 亦屬 scope |
| [candidate-manifest.json](review-material/candidate-manifest.json) | 本地 candidate baseline、patch integrity 同八個新 files 嘅 hashes |
| [local-candidate.patch](review-material/local-candidate.patch) | Tracked diff 同八個 untracked source/docs files；只供 independent review |

Canonical acceptance：[Spec #66](https://github.com/Noahlw/efcc-system/issues/66)、各 implementation issue body/comments 同 [PR #47](https://github.com/Noahlw/efcc-system/pull/47) live state。Snapshot 同本文件唔取代 tracker。Historical handoff 內嘅指示唔自動授權 remote action。

## Candidate provenance 同處置

本地 candidate branch 係 `codex/efcc-testing-foundation`，baseline `ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf`。Patch 包含 tracked working-tree diff 同八個 new files；唔包含 `.scratch` reports、DB、auth state、credentials、private traces、dependencies 或 build outputs。呢份 baseline 唔係永久 live PR HEAD。

原件仍留喺 owner 本地，冇 stage／commit／reset；交接 commit 只新增呢個 package。Remote agent 應先讀 patch，同最新 source 比較，記錄每項 disposition；唔直接 apply 去 integration branch，唔將 failed experiments 當 pass。若必要，對 recorded baseline 喺 disposable workspace 檢查／重現。

完成 independent review 同 disposition 後，按 N18 刪除 patch 同 manifest。Research／coverage／index 如已過時亦要收口到必要 ADR history 同 current workflow，避免 duplicate authority。

## 最新 owner corrections

- Previous fixes 同 visual closeout 已接受；舊 PR acceptance-pending 文字屬 stale record。
- Architecture 同真正删除 redundant custom infrastructure 係首要目標；唔加 speed benchmark／guaranteed倍率／macOS-Linux full compatibility gate。
- Ordinary worker runtime／DB 重用，case-owned state；special cases fresh store，scenario 中途唔 reset。
- Build artifacts 可跨 invocation reuse，required tests 每次重新執行。
- GitHub CI 保持 slim；重型 qualification 留 local，bypass 要披露。
- OMP config 使用 remote session 有效版本；唔依賴 owner macOS absolute paths，唔傳輸 agent credentials/config。
