import type { ParticipationState } from "./queries";

interface ParticipationCopy {
  label: string;
  /** True when the state must not read as confirmed attendance. */
  unconfirmed: boolean;
}

export const participationCopy: Record<ParticipationState, ParticipationCopy> =
  {
    approved: { label: "報名已批准", unconfirmed: false },
    pending: { label: "待批核", unconfirmed: true },
    waitlisted: { label: "候補中", unconfirmed: true },
  };
