import { SignUp } from '@clerk/clerk-react';

export function SignUpPage() {
    return (
        <div className="fixed inset-0 flex items-center justify-center bg-background">
            <SignUp
                routing="path"
                path="/sign-up"
                signInUrl="/sign-in"
                afterSignUpUrl="/"
            />
        </div>
    );
}
