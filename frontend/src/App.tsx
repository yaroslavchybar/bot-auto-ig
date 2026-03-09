import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
const SignInPage = lazy(() =>
  import('./pages/SignInPage').then((module) => ({
    default: module.SignInPage,
  })),
)
const SignUpPage = lazy(() =>
  import('./pages/SignUpPage').then((module) => ({
    default: module.SignUpPage,
  })),
)
const ProtectedApp = lazy(() => import('./ProtectedApp'))

function App() {
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <div className="text-subtle-copy flex min-h-screen items-center justify-center text-sm">
            Loading...
          </div>
        }
      >
        <Routes>
          <Route path="/sign-in/*" element={<SignInPage />} />
          <Route path="/sign-up/*" element={<SignUpPage />} />
          <Route path="/*" element={<ProtectedApp />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App


