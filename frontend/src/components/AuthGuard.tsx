import { useAuth } from '@clerk/clerk-react';
import { Navigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';

interface AuthGuardProps {
    children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
    const { isLoaded, isSignedIn } = useAuth();

    if (!isLoaded) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="text-center">
                    <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading...</p>
                </div>
            </div>
        );
    }

    if (!isSignedIn) {
        return <Navigate to="/sign-in" replace />;
    }

    return <>{children}</>;
}
