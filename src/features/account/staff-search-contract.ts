import { BusinessApiError } from "./business-error-contract";

/** Display identity only: deliberately distinct from canonical sign-in keys. */
export const staffSearchKey = (
  fullName: string,
  username: string | null
): string => `${fullName} ${username ?? ""}`.toLowerCase();

export const parseStaffSearch = (query: string | undefined): string => {
  const trimmed = query?.trim() ?? "";
  if ([...trimmed].length > 100) {
    throw new BusinessApiError(
      400,
      "validation_error",
      "搜尋內容最多可輸入 100 個字。"
    );
  }
  return trimmed.toLowerCase();
};

export const STAFF_ACCOUNT_PAGE_SIZE = 25;

export const normalizedStaffAccountPage = (
  value: string | undefined
): number => {
  if (!value || !/^\d+$/u.test(value)) {
    return 1;
  }
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0
    ? Math.min(
        page,
        Math.floor(Number.MAX_SAFE_INTEGER / STAFF_ACCOUNT_PAGE_SIZE)
      )
    : 1;
};
