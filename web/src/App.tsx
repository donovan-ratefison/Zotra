import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { StudioShell } from "@/studio/StudioShell";
import { IntroSplash } from "@/studio/IntroSplash";
import { ProcessLibrary } from "@/studio/ProcessLibrary";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

// The server answers index.html on /processes: the page choice is here.
const libraryPage = typeof window !== "undefined" && window.location.pathname === "/processes";

export default function App() {
  return (
    <QueryClientProvider client={client}>
      <ReactFlowProvider>
        {libraryPage ? <ProcessLibrary /> : <StudioShell />}
        <IntroSplash />
      </ReactFlowProvider>
    </QueryClientProvider>
  );
}
