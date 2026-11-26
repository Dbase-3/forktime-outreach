"use client";

// Server data for paged lists and figures (contacts, calls, analytics, Home):
// cached per query, refetched in the background, kept while the next page loads.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
