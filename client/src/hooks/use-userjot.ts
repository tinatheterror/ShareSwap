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
  username?: string;
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

export function useUserJot({ userId, username }: UseUserJotOptions) {
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

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;

    window.uj.identify({
      id: String(userId),
      name: username || undefined,
    });

    window.uj.setCustomFields?.({
      device_type: isMobile ? "mobile" : "web",
      page_url: window.location.href,
    });
  }, [userId, username]);

  const openFeedback = useCallback(() => {
    if (window.uj?.showWidget) {
      window.uj.showWidget({ section: "feedback" });
    }
  }, []);

  return { openFeedback };
}
