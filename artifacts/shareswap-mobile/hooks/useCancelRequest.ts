import * as React from "react";
import { createUseCancelRequest } from "@workspace/api-client-react/cancel-flow";

/** The cancel flow shared with the web app (see lib/api-client-react/src/cancel-flow.ts). */
export const useCancelRequest = createUseCancelRequest(React);
