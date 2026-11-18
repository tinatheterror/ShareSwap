// The API owns the fixed platform time zone and sends `startDatePassed`;
// the app only displays it.
export const REQUEST_DATES_PASSED_MESSAGE =
  "These dates have passed. Counter with new dates or decline.";

export function acceptBlockedByDates(request: {
  status: string;
  startDatePassed?: boolean;
}): boolean {
  return request.status === "PENDING" && request.startDatePassed === true;
}

/** What the server answers, whatever the reason, when a request cannot be accepted right now (api-server/src/sharecoin-funds.ts). */
export const REQUEST_NOT_ACCEPTABLE_NOW_CODE = "REQUEST_NOT_ACCEPTABLE_NOW";
export const REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE = "This can't be accepted right now. Please try again later.";
