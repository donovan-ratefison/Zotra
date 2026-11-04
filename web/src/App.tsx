import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { StudioShell } from "@/studio/StudioShell";
import { IntroSplash } from "@/studio/IntroSplash";
import { ProcessLibrary } from "@/studio/ProcessLibrary";
import { BankSettings } from "@/studio/BankSettings";
import { isLibraryPage } from "@/studio/library";
import { ReplayBanner } from "@/studio/ReplayBanner";

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
        {/* The banner takes its height from the page: the studio
            screens fill the rest, and the page scroll stays inside. */}
        <div className="flex h-screen flex-col">
          <ReplayBanner />
          <div className="min-h-0 flex-1 overflow-y-auto [&>.h-screen]:h-full [&>.min-h-screen]:min-h-full">
            {settingsPage ? <BankSettings /> : libraryPage ? <ProcessLibrary /> : <StudioShell />}
          </div>
        </div>
        <IntroSplash />
      </ReactFlowProvider>
    </QueryClientProvider>
  );
}
