import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AppShell } from "./app/AppShell";
import { FeedbackBoard } from "./feedback/FeedbackBoard";
import { ReportButton } from "./feedback/ReportButton";
import { Toaster } from "@/ui/sonner";
import "@fontsource-variable/inter/index.css";
import "./styles.css";

// No router yet: main.tsx chooses the page from the path.
const board = window.location.pathname === "/_feedback";
const app = window.location.pathname.startsWith("/app");

// The delivered app owns its client, like App owns the studio one.
const appClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {board ? (
      <FeedbackBoard />
    ) : (
      <>
        {app ? (
          <QueryClientProvider client={appClient}>
            <AppShell />
          </QueryClientProvider>
        ) : (
          <App />
        )}
        <ReportButton />
      </>
    )}
    {/* Always rendered, so the toasts of the button and of the board
        both show. The button owns the bottom right. */}
    <Toaster position="bottom-left" />
  </React.StrictMode>,
);
