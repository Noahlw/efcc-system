import { staffReceiptMatchesOperation } from "./staff-account-contract";
import type {
  StaffAccountReceipt,
  StoredStaffAccountOperation,
} from "./staff-account-contract";

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
      readonly kind: "recovery";
      readonly receipt: RecoveryReceipt;
      readonly issuance: StaffIssuance | null;
    };

/** Bind either handover to its original operation, never to receipt-derived intent. */
export const staffAccountHandoverFromOperation = (
  operation: Readonly<StoredStaffAccountOperation>,
  identity: StaffHandoverIdentity | null,
  receipt: StaffAccountReceipt,
  issuance: StaffIssuance | null,
  authContextMarker: string | null
): StaffAccountHandover | null => {
  if (!staffReceiptMatchesOperation(receipt, operation)) {
    return null;
  }
  const common = {
    actorUserId: operation.actorUserId,
    authContextMarker,
    identity,
    issuance,
  };
  if (operation.action === "assisted_account_created") {
    const creationReceipt: CreationReceipt = {
      ...receipt,
      action: operation.action,
    };
    return {
      ...common,
      kind: "creation",
      receipt: creationReceipt,
    };
  }
  const recoveryReceipt: RecoveryReceipt = {
    ...receipt,
    action: operation.action,
  };
  return {
    ...common,
    kind: "recovery",
    receipt: recoveryReceipt,
  };
};
