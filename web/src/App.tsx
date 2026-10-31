import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { StudioShell } from "@/studio/StudioShell";
import { IntroSplash } from "@/studio/IntroSplash";
import { ProcessLibrary } from "@/studio/ProcessLibrary";
import { BankSettings } from "@/studio/BankSettings";
import { isLibraryPage } from "@/studio/library";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

// The server answers index.html on each page path: the page choice is here.
const libraryPage =
  typeof window !== "undefined" && isLibraryPage(window.location.pathname, window.location.search);

const settingsPage = typeof window !== "undefined" && window.location.pathname === "/settings";

export default function App() {
  return (
    <QueryClientProvider client={client}>
      <ReactFlowProvider>
        {settingsPage ? <BankSettings /> : libraryPage ? <ProcessLibrary /> : <StudioShell />}
        <IntroSplash />
      </ReactFlowProvider>
    </QueryClientProvider>
  );
}
