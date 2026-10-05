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
