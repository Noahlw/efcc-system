import type { ProtectedPageHref } from "@/shared/protected-pages";

export type StaffTaskName =
  | "create"
  | "recovery"
  | "identity"
  | "restrictions"
  | "deletion";
export type StaffPersonTask = Exclude<StaffTaskName, "create">;

export interface StaffTaskActorIdentity {
  actorName?: string;
  actorUsername: string | null;
  confirmationExpiresAt: number | null;
}

export interface StaffTaskActorContext {
  userId: string;
  identity?: StaffTaskActorIdentity;
}

export interface StaffTaskReturnContext {
  href: ProtectedPageHref;
  label: string;
}

interface StaffTaskContextBase {
  actor: StaffTaskActorContext;
  returnTo: StaffTaskReturnContext;
}

export interface StaffCreateTaskContext extends StaffTaskContextBase {
  task: "create";
  targetUserId: null;
}

export interface StaffPersonTaskContext extends StaffTaskContextBase {
  task: StaffPersonTask;
  targetUserId: string;
}

export interface StaffRecoveryTaskContext extends StaffTaskContextBase {
  task: "recovery";
  targetUserId: string;
}

export type StaffAccountsTaskContext =
  | StaffCreateTaskContext
  | StaffRecoveryTaskContext;

/** Shared reference binding; task-specific action metadata stays local. */
export interface StaffOperationReference {
  actorUserId: string;
  key: string;
  targetUserId: string | null;
}
