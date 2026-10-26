import { Button } from "@/ui/button";

export default function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-2xl font-semibold">Zotra</h1>
      <p className="text-muted-foreground">
        From credit policy to a tested approval app.
      </p>
      <Button disabled className="mt-4">
        Open the studio
      </Button>
    </main>
  );
}
