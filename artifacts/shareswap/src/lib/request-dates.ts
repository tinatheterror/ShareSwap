// The API decides whether a request's start day has passed (it owns the fixed
// platform time zone) and sends it as `startDatePassed`; clients only show it.
export const REQUEST_DATES_PASSED_MESSAGE =
  "Dates have passed. Counter with new dates or decline.";

export function acceptBlockedByDates(request: {
  status: string;
  startDatePassed?: boolean;
}): boolean {
  return request.status === "PENDING" && request.startDatePassed === true;
}

/** What the server answers, whatever the reason, when a request cannot be accepted right now (api-server/src/sharecoin-funds.ts). */
export const REQUEST_NOT_ACCEPTABLE_NOW_CODE = "REQUEST_NOT_ACCEPTABLE_NOW";
export const REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE = "This can't be accepted right now. Please try again later.";
