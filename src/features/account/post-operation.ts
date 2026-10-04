/** Bind a page's operation to its actor even if another tab changes the cookie. */
export const postAccountOperation = (
  actorUserId: string,
  path: string,
  body: object
) =>
  fetch(path, {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-efcc-expected-actor-id": actorUserId,
    },
    method: "POST",
  });
