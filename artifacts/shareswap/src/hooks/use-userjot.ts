import { useEffect, useCallback } from "react";

declare global {
  interface Window {
    $ujq: any[];
    uj: any;
    __userjotInitialized?: boolean;
  }
}

interface UseUserJotOptions {
  userId?: number;
}

let scriptLoaded = false;

function loadSDK() {
  if (scriptLoaded) return;
  scriptLoaded = true;

  window.$ujq = window.$ujq || [];
  window.uj = window.uj || new Proxy({}, {
    get: (_: any, p: string) => (...a: any[]) => window.$ujq.push([p, ...a])
  });

  const script = document.createElement("script");
  script.src = "https://cdn.userjot.com/sdk/v2/uj.js";
  script.type = "module";
  script.async = true;
  document.head.appendChild(script);
}

/**
 * The website feedback widget (UserJot). The only thing it is told about the person is the internal user number, so feedback can
 * be tied to an account: no email address, username or name, and no page URL or other custom fields (URLs can carry query
 * strings). Website only: the mobile app opens the public board in the browser and passes nothing (see FEEDBACK_URL).
 */
export function useUserJot({ userId }: UseUserJotOptions) {
  useEffect(() => {
    const projectId = import.meta.env.VITE_USERJOT_PROJECT_ID;
    if (!projectId || !userId) return;

    loadSDK();

    if (!window.__userjotInitialized) {
      window.__userjotInitialized = true;
      window.uj.init(projectId, {
        widget: true,
        trigger: "custom",
        theme: "light",
      });
    }

    window.uj.identify({ id: String(userId) });
  }, [userId]);

  const openFeedback = useCallback(() => {
    if (window.uj?.showWidget) {
      window.uj.showWidget({ section: "feedback" });
    }
  }, []);

  return { openFeedback };
}
