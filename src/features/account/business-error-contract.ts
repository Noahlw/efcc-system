/** Existing business error codes, grouped by their public HTTP status. */
export const businessErrorCodes = {
  400: ["validation_error", "invalid_password"],
  401: ["unauthorized"],
  403: [
    "business_access_denied",
    "origin_denied",
    "password_change_required",
    "temporary_password_expired",
    "password_confirmation_required",
    "identity_verification_required",
    "applicant_access_denied",
  ],
  404: ["not_found"],
  409: [
    "conflict",
    "actor_changed",
    "client_update_required",
    "stale_identity",
    "church_history_retained",
    "security_ban_active",
    "last_effective_admin",
  ],
  429: ["rate_limited"],
  500: ["internal_error"],
} as const;

type BusinessErrorStatus = keyof typeof businessErrorCodes;
type BusinessErrorCode<Status extends BusinessErrorStatus> =
  (typeof businessErrorCodes)[Status][number];

/** Hono's global responses derive the same status/code facts as thrown errors. */
export type BusinessErrorResponses = {
  [Status in BusinessErrorStatus]: {
    json: { error: { code: BusinessErrorCode<Status>; message: string } };
  };
};

// Not-found and unexpected-error responses remain the router's responsibility.
type ThrownBusinessErrorStatus = Exclude<BusinessErrorStatus, 404 | 500>;
type BusinessFailureArguments = {
  [Status in ThrownBusinessErrorStatus]: [
    status: Status,
    code: BusinessErrorCode<Status>,
    message: string,
  ];
}[ThrownBusinessErrorStatus];

export class BusinessApiError extends Error {
  readonly code: BusinessErrorCode<ThrownBusinessErrorStatus>;
  readonly status: ThrownBusinessErrorStatus;

  constructor(...[status, code, message]: BusinessFailureArguments) {
    super(message);
    this.name = "BusinessApiError";
    this.code = code;
    this.status = status;
  }
}
