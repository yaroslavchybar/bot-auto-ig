import { SignIn } from '@clerk/clerk-react';

export function SignInPage() {
    return (
        <div className="fixed inset-0 flex items-center justify-center bg-background">
            <SignIn
                routing="path"
                path="/sign-in"
                signUpUrl="/sign-up"
                afterSignInUrl="/"
            />
        </div>
    );
}
