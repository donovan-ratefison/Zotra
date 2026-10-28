import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { FeedbackBoard } from "./feedback/FeedbackBoard";
import { ReportButton } from "./feedback/ReportButton";
import { Toaster } from "@/ui/sonner";
import "@fontsource-variable/inter/index.css";
import "./styles.css";

// No router yet: main.tsx chooses the page from the path.
const board = window.location.pathname === "/_feedback";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {board ? (
      <FeedbackBoard />
    ) : (
      <>
        <App />
        <ReportButton />
      </>
    )}
    {/* Always rendered, so the toasts of the button and of the board
        both show. The button owns the bottom right. */}
    <Toaster position="bottom-left" />
  </React.StrictMode>,
);
