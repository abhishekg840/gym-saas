import { Suspense } from 'react';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-400">
          Loading login...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
