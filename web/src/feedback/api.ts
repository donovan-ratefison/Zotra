// The client of the feedback API of lot 2.0b. Plain fetch, no
// library. Contract: local/plan.md section 8.

export type FeedbackBox = { x: number; y: number; width: number; height: number };

export type FeedbackViewport = { width: number; height: number };

export type FeedbackHistory = {
  at: string;
  status: string;
  by: string;
  note: string;
  fix: string[];
};

// FeedbackItem is one remark, with the 17 fields of the file format.
export type FeedbackItem = {
  id: string;
  status: string;
  kind: string;
  text: string;
  url: string;
  selector: string | null;
  element_text: string | null;
  box: FeedbackBox | null;
  viewport: FeedbackViewport;
  image: string | null;
  commit: string;
  created_at: string;
  lot: string | null;
  understood: string | null;
  fix: string[];
  fixed_commit: string | null;
  history: FeedbackHistory[];
};

export type CreateBody = {
  kind: string;
  text: string;
  url: string;
  selector: string | null;
  element_text: string | null;
  box: FeedbackBox | null;
  viewport: FeedbackViewport;
  image_data: string | null;
};

const BASE = "/api/dev/feedback";

// errorText reads the message of the JSON error body of the API. A
// body it cannot read gives the status text.
async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

// listFeedback returns the items, highest id first, or null when the
// API is absent (any non-200 answer).
export async function listFeedback(): Promise<FeedbackItem[] | null> {
  const res = await fetch(BASE);
  if (!res.ok) return null;
  return (await res.json()) as FeedbackItem[];
}

// createFeedback posts one remark and returns the new item. On a
// non-201 answer it throws an Error with the message of the error
// body.
export async function createFeedback(body: CreateBody): Promise<FeedbackItem> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status !== 201) throw new Error(await errorText(res));
  return (await res.json()) as FeedbackItem;
}

// verifyFeedback sets a fixed item to verified. It throws on failure.
export async function verifyFeedback(id: string): Promise<FeedbackItem> {
  const res = await fetch(`${BASE}/${id}/verify`, { method: "POST" });
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()) as FeedbackItem;
}

// reopenFeedback sends the note and returns the reopened item.
export async function reopenFeedback(id: string, note: string): Promise<FeedbackItem> {
  const res = await fetch(`${BASE}/${id}/reopen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()) as FeedbackItem;
}

// feedbackImageURL returns the image path of one item.
export function feedbackImageURL(id: string): string {
  return `${BASE}/${id}/image`;
}
