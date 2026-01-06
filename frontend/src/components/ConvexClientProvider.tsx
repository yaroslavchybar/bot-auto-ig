
import type { ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

const convexUrl = (import.meta.env.VITE_CONVEX_URL as string) || "https://wooden-ostrich-766.convex.cloud";

const convex = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
    return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
