// The API decides whether a request's start day has passed (it owns the fixed
// platform time zone) and sends it as `startDatePassed`; clients only show it.
export const REQUEST_DATES_PASSED_MESSAGE =
  "These dates have passed. Counter with new dates or decline.";

export function acceptBlockedByDates(request: {
  status: string;
  startDatePassed?: boolean;
}): boolean {
  return request.status === "PENDING" && request.startDatePassed === true;
}
