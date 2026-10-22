"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  prepareAuthContextMarker,
  readAuthContextMarker,
} from "@/features/auth/auth-context-marker";

import {
  discardSessionDraft,
  draftBaselineSchema,
  draftLifetime,
  linkSessionDraft,
  draftStoragePrefix,
  draftValues,
  readSessionDraft,
  sessionDraftSchema,
} from "./session-draft";
import type {
  DraftBaseline,
  DraftFlow,
  DraftValues,
  SessionDraft,
} from "./session-draft";

interface DraftOptions {
  actorUserId: string;
  baseline: DraftBaseline;
  denied: boolean;
  dirty: boolean;
  enabled: boolean;
  flow: DraftFlow;
  busy: boolean;
  operation: object | null;
  state: string;
  targetId: string;
  values: DraftValues;
  onRestore: (values: DraftValues, stale: boolean) => void;
  onAuthorityLost: () => void;
}

/** Draft persistence never owns a command, receipt, operation key, or retry. */
export const useSessionDraftRecovery = (options: DraftOptions) => {
  const ready =
    !options.busy &&
    options.operation === null &&
    ["ready", "rejected"].includes(options.state);
  const latest = useRef({ ...options, ready });
  latest.current = { ...options, ready };
  const runtime = useRef({
    authContext: "",
    initialized: false,
    invalidated: false,
    leavingDocument: false,
    previousValues: "",
    record: null as SessionDraft | null,
  });
  const [pending, setPending] = useState<SessionDraft | null>(null);
  const [notice, setNotice] = useState("");
  const values = JSON.stringify(draftValues(options.flow, options.values));
  const identity = JSON.stringify([
    options.flow,
    options.actorUserId,
    options.targetId,
  ]);
  const key = `${draftStoragePrefix}${options.flow}`;

  const clear = () => {
    if (!latest.current.enabled) {
      return true;
    }
    try {
      discardSessionDraft(latest.current.flow);
      runtime.current.record = null;
      runtime.current.previousValues = JSON.stringify(
        draftValues(latest.current.flow, latest.current.values)
      );
      setPending(null);
      setNotice("");
      return true;
    } catch {
      setNotice("未能清除暫存草稿；輸入仍在此頁。請恢復瀏覽器儲存後再試。");
      return false;
    }
  };

  useEffect(() => {
    if (!options.enabled) {
      return;
    }
    const state = runtime.current;
    state.authContext = "";
    state.initialized = false;
    state.invalidated = false;
    state.leavingDocument = false;
    state.record = null;
    setPending(null);
    setNotice("");
    const leaving = () => {
      state.leavingDocument = true;
    };
    const recheck = () => {
      if (state.authContext && readAuthContextMarker() !== state.authContext) {
        state.invalidated = true;
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* No authority is inferred from storage. */
        }
        state.record = null;
        setPending(null);
        setNotice("");
        latest.current.onAuthorityLost();
      }
    };
    window.addEventListener("pagehide", leaving);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    const { cookieStore } = globalThis;
    cookieStore?.addEventListener("change", recheck);
    return () => {
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
      cookieStore?.removeEventListener("change", recheck);
      if (!state.leavingDocument) {
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* Expiry and restore validation still apply. */
        }
      }
    };
  }, [identity, key, options.enabled]);

  useEffect(() => {
    const state = runtime.current;
    if (options.denied || options.state === "denied") {
      state.invalidated = true;
      try {
        sessionStorage.removeItem(key);
      } catch {
        // A denied task never restores or writes a draft.
      }
      state.record = null;
      setPending(null);
      return;
    }
    if (!options.enabled || state.invalidated) {
      return;
    }
    if (!state.initialized) {
      state.initialized = true;
      state.previousValues = values;
      try {
        state.authContext = prepareAuthContextMarker();
        const saved = readSessionDraft(sessionStorage, options.flow, {
          actorUserId: options.actorUserId,
          authContext: state.authContext,
          targetId: options.targetId,
        });
        state.record = saved;
        setPending(saved);
      } catch {
        setNotice("未能暫存草稿；輸入仍在此頁，但重新整理後可能需要重新填寫。");
      }
      return;
    }
    if (!ready || pending !== null || state.previousValues === values) {
      return;
    }
    state.previousValues = values;
    if (!options.dirty) {
      clear();
      return;
    }
    try {
      if (!state.authContext || readAuthContextMarker() !== state.authContext) {
        throw new Error("Auth context changed");
      }
      const record = sessionDraftSchema.parse({
        actorUserId: options.actorUserId,
        authContext: state.authContext,
        baseline: state.record?.baseline ?? options.baseline,
        flow: options.flow,
        savedAt: Date.now(),
        targetId: options.targetId,
        values: JSON.parse(values),
        version: 1,
      });
      // Keep the current allowed values even if persistence fails; linking must
      // never fall back to a missing or older stored draft before transmission.
      state.record = record;
      const raw = JSON.stringify(record);
      sessionStorage.setItem(key, raw);
      if (sessionStorage.getItem(key) !== raw) {
        throw new Error("Draft not stored");
      }
      setNotice("已暫存於此分頁，尚未提交。最後修改後 30 分鐘到期。");
    } catch {
      setNotice("未能暫存草稿；輸入仍在此頁，但重新整理後可能需要重新填寫。");
    }
  });

  useEffect(() => {
    const { record } = runtime.current;
    if (!record) {
      return;
    }
    const expire = () => {
      if (runtime.current.record !== record) {
        return;
      }
      if (clear()) {
        setNotice("暫存草稿已到期；此頁現有輸入仍會保留。");
      }
    };
    const timeout = window.setTimeout(
      expire,
      Math.max(0, record.savedAt + draftLifetime - Date.now())
    );
    return () => window.clearTimeout(timeout);
  });

  const restore = () => {
    if (!latest.current.ready || runtime.current.invalidated) {
      return;
    }
    try {
      const saved = readSessionDraft(sessionStorage, options.flow, {
        actorUserId: options.actorUserId,
        authContext: readAuthContextMarker() ?? "",
        targetId: options.targetId,
      });
      if (!saved) {
        clear();
        setNotice("暫存草稿已到期或不適用，請重新填寫。");
        return;
      }
      if (saved.submittedOperationKey !== null) {
        return;
      }
      runtime.current.record = saved;
      runtime.current.previousValues = JSON.stringify(saved.values);
      setPending(null);
      setNotice("已恢復未提交草稿；請重新核對資料及完成必要確認。");
      latest.current.onRestore(
        saved.values,
        JSON.stringify(saved.baseline) !==
          JSON.stringify(draftBaselineSchema.parse(latest.current.baseline))
      );
    } catch {
      setNotice("未能讀取暫存草稿；請恢復瀏覽器儲存後再試。");
    }
  };
  const blocked = options.enabled && pending !== null;
  const noticeView = options.enabled ? (
    <div className="text-label mb-4" data-draft-recovery={options.flow}>
      {blocked && ready && pending?.submittedOperationKey === null ? (
        <>
          <p>
            找到此工作未提交的草稿。恢復後仍須重新核對，並不代表已完成操作。
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button disabled={!ready} type="button" onClick={restore}>
              恢復未提交草稿
            </Button>
            <Button
              disabled={!ready}
              type="button"
              variant="secondary"
              onClick={clear}
            >
              放棄草稿
            </Button>
          </div>
        </>
      ) : null}
      {blocked && ready && pending?.submittedOperationKey ? (
        <p aria-live="polite" aria-atomic="true">
          此草稿連結原操作，請先查核原操作記錄；不會用草稿重播提交。
        </p>
      ) : null}
      {ready && !pending?.submittedOperationKey && notice ? (
        <p aria-live="polite" aria-atomic="true">
          {notice}
        </p>
      ) : null}
    </div>
  ) : null;
  return {
    blocked,
    clear,
    dirty: options.dirty || pending?.submittedOperationKey === null,
    linkSubmission: (operationKey: string, applies = true) => {
      if (options.enabled && applies) {
        const state = runtime.current;
        if (
          state.invalidated ||
          !state.authContext ||
          readAuthContextMarker() !== state.authContext
        ) {
          throw new Error("Draft auth context changed");
        }
        linkSessionDraft(
          options.flow,
          operationKey,
          options.actorUserId,
          options.targetId,
          state.record ?? undefined
        );
      }
    },
    notice: noticeView,
  };
};
