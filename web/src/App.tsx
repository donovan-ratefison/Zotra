import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { StudioShell } from "@/studio/StudioShell";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

export default function App() {
  return (
    <QueryClientProvider client={client}>
      <ReactFlowProvider>
        <StudioShell />
      </ReactFlowProvider>
    </QueryClientProvider>
  );
}
