import type { StaffAccountReceipt } from "./staff-account-contract";

export interface StaffHandoverIdentity {
  readonly fullName: string;
  readonly username: string;
}

export interface StaffIssuance {
  readonly temporaryPassword: string;
  readonly temporaryPasswordExpiresAt: number;
}

type CreationReceipt = Omit<StaffAccountReceipt, "action"> & {
  action: "assisted_account_created";
};
type RecoveryReceipt = Omit<StaffAccountReceipt, "action"> & {
  action: "staff_password_reset" | "temporary_password_reissued";
};

export type StaffAccountHandover =
  | {
      readonly actorUserId: string;
      readonly authContextMarker: string | null;
      readonly identity: StaffHandoverIdentity | null;
      readonly kind: "creation";
      readonly receipt: CreationReceipt;
      readonly issuance: StaffIssuance | null;
    }
  | {
      readonly actorUserId: string;
      readonly authContextMarker: string | null;
      readonly identity: StaffHandoverIdentity | null;
      readonly kind: "recovery-compatibility";
      readonly receipt: RecoveryReceipt;
      readonly issuance: StaffIssuance | null;
    };

/** Maps an existing recovery receipt to the temporary C01 consumer contract. */
const adaptLegacyRecoveryHandover = (
  actorUserId: string,
  identity: StaffHandoverIdentity | null,
  receipt: StaffAccountReceipt,
  issuance: StaffIssuance | null,
  authContextMarker: string | null
): StaffAccountHandover | null => {
  if (receipt.action === "assisted_account_created") {
    return null;
  }
  const recoveryReceipt: RecoveryReceipt = {
    ...receipt,
    action:
      receipt.action === "staff_password_reset"
        ? "staff_password_reset"
        : "temporary_password_reissued",
  };
  return {
    actorUserId,
    authContextMarker,
    identity,
    issuance,
    kind: "recovery-compatibility",
    receipt: recoveryReceipt,
  };
};

export const staffAccountHandoverFromReceipt = (
  actorUserId: string,
  identity: StaffHandoverIdentity | null,
  receipt: StaffAccountReceipt,
  issuance: StaffIssuance | null,
  authContextMarker: string | null
): StaffAccountHandover | null => {
  if (receipt.action === "assisted_account_created") {
    const creationReceipt: CreationReceipt = {
      ...receipt,
      action: "assisted_account_created",
    };
    return {
      actorUserId,
      authContextMarker,
      identity,
      issuance,
      kind: "creation",
      receipt: creationReceipt,
    };
  }
  return adaptLegacyRecoveryHandover(
    actorUserId,
    identity,
    receipt,
    issuance,
    authContextMarker
  );
};
