
import type { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/clerk-react";

const convexUrl = (import.meta.env.VITE_CONVEX_URL || import.meta.env.CONVEX_URL) as string | undefined;

if (!convexUrl) {
    throw new Error("Missing Convex URL. Set VITE_CONVEX_URL (preferred) or CONVEX_URL.");
}

const convex = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
    return (
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
            {children}
        </ConvexProviderWithClerk>
    );
}
