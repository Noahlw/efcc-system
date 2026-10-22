import { afterEach, describe, expect, it, vi } from "vitest";

import {
  linkSessionDraft,
  settleSessionDraft,
  draftLifetime,
  draftStoragePrefix,
  draftValues,
  readSessionDraft,
  sessionDraftSchema,
} from "@/features/account/session-draft";

const owner = {
  actorUserId: "staff",
  authContext: "login-generation",
  targetId: "member",
};
const draft = {
  ...owner,
  baseline: { contact: null, status: null },
  flow: "identity" as const,
  savedAt: 100,
  values: {
    email: "test@example.com",
    fullName: "陳草稿",
    phone: "6",
    sharedPhone: false,
    username: "test",
  },
  version: 1 as const,
};
const storageWith = (value: unknown) => {
  let raw: string | null =
    typeof value === "string" ? value : JSON.stringify(value);
  return {
    getItem: () => raw,
    removeItem: () => {
      raw = null;
    },
    setItem: (_key: string, nextValue: string) => {
      raw = nextValue;
    },
  } as unknown as Storage;
};

afterEach(() => vi.unstubAllGlobals());

describe("short-lived unsubmitted drafts", () => {
  it("retains incomplete field input, but serialization never picks verification, passwords or request state", () => {
    const values = {
      ...draft.values,
      identityCheck: "verified_phone",
      identityVerified: true,
      operationKey: "never-copy",
      password: "never-store",
      temporaryPassword: "never-store",
      verified: true,
    };
    expect(draftValues("identity", values)).toEqual(draft.values);
    expect(draftValues("applicant", values)).toEqual({
      email: values.email,
      fullName: values.fullName,
      phone: "6",
    });
    expect(sessionDraftSchema.safeParse({ ...draft, values }).success).toBe(
      false
    );
    expect(
      readSessionDraft(storageWith(draft), "identity", owner, 101)?.values.phone
    ).toBe("6");
  });

  it("expires at exactly thirty minutes without turning a read into a new edit", () => {
    const storage = storageWith(draft);
    expect(
      readSessionDraft(
        storage,
        "identity",
        owner,
        draft.savedAt + draftLifetime - 1
      )
    ).not.toBeNull();
    expect(
      readSessionDraft(
        storage,
        "identity",
        owner,
        draft.savedAt + draftLifetime
      )
    ).toBeNull();
    expect(storage.getItem(`${draftStoragePrefix}identity`)).toBeNull();
  });

  it.each([
    { actorUserId: "another" },
    { targetId: "another" },
    { authContext: "next-login" },
  ])("rejects a different owner or login generation: %j", (different) => {
    expect(
      readSessionDraft(
        storageWith(draft),
        "identity",
        { ...owner, ...different },
        101
      )
    ).toBeNull();
  });

  it.each([
    "{broken",
    { ...draft, version: 2 },
    { ...draft, savedAt: 1000 },
    { ...draft, baseline: { contact: null, password: "secret", status: null } },
    { ...draft, flow: "applicant" },
  ])("drops malformed, future or foreign records: %j", (bad) => {
    const storage = storageWith(bad);
    expect(readSessionDraft(storage, "identity", owner, 101)).toBeNull();
    expect(storage.getItem(`${draftStoragePrefix}identity`)).toBeNull();
  });
});

describe("draft and existing-operation ownership", () => {
  it.each([false, true])(
    "binds the current draft after storage recovers, preserving its edit time (older saved draft: %s)",
    (hasOlderDraft) => {
      const storage = storageWith(draft);
      if (!hasOlderDraft) {
        storage.removeItem("unused");
      }
      vi.stubGlobal("sessionStorage", storage);
      const current = sessionDraftSchema.parse({
        ...draft,
        savedAt: 101,
        values: { ...draft.values, fullName: "陳最新草稿" },
      });
      const key = "6f3d1c9a-3b2e-4c6f-8a1b-2c3d4e5f6071";
      linkSessionDraft(
        "identity",
        key,
        owner.actorUserId,
        owner.targetId,
        current
      );
      const linked = readSessionDraft(storage, "identity", owner, 102);
      expect(linked?.values.fullName).toBe("陳最新草稿");
      expect(linked?.savedAt).toBe(101);
      expect(linked?.submittedOperationKey).toBe(key);
    }
  );

  it("keeps an uncertain submission linked; only that exact confirmed key can consume it", () => {
    const storage = storageWith(draft);
    vi.stubGlobal("sessionStorage", storage);
    const key = "6f3d1c9a-3b2e-4c6f-8a1b-2c3d4e5f6071";
    linkSessionDraft("identity", key, owner.actorUserId, owner.targetId);
    const linked = readSessionDraft(storage, "identity", owner, 101);
    expect(linked?.values).toEqual(draft.values);
    expect(linked?.submittedOperationKey).toBe(key);
    settleSessionDraft(
      "identity",
      "6f3d1c9a-3b2e-4c6f-8a1b-2c3d4e5f6072",
      true
    );
    expect(
      readSessionDraft(storage, "identity", owner, 101)?.submittedOperationKey
    ).toBe(key);
    settleSessionDraft("identity", key, true);
    expect(storage.getItem("unused")).toBeNull();
  });

  it("definitive rejection releases the draft without extending its original expiry", () => {
    const storage = storageWith(draft);
    vi.stubGlobal("sessionStorage", storage);
    const key = "6f3d1c9a-3b2e-4c6f-8a1b-2c3d4e5f6071";
    linkSessionDraft("identity", key, owner.actorUserId, owner.targetId);
    settleSessionDraft("identity", key, false);
    const retained = readSessionDraft(storage, "identity", owner, 101);
    expect(retained?.values).toEqual(draft.values);
    expect(retained?.submittedOperationKey).toBeNull();
    expect(retained?.savedAt).toBe(draft.savedAt);
  });
});
