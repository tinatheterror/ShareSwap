import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Suppress Vite HMR WebSocket errors in environments where HMR WS isn't
// available (e.g. Replit custom domains). These are benign but the
// @replit/vite-plugin-runtime-error-modal treats unhandledrejections as
// crashes and shows a full-screen error modal.
window.addEventListener(
  "unhandledrejection",
  (event) => {
    const msg = event.reason?.message ?? String(event.reason ?? "");
    if (msg.includes("wss://localhost:undefined") || msg.includes("WebSocket")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true, // capture phase — runs before Vite's handler
);

createRoot(document.getElementById("root")!).render(<App />);
