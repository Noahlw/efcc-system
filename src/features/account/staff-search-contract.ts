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
