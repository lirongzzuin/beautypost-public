import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toast } from '@beautypost/ui'
import { router } from './router'
import { useAuthStore } from './store/auth'
import { ErrorBoundary } from '~/components/ErrorBoundary'
import '~/styles/tokens.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

// After a new deployment, a page loaded from the old build may try to lazy-load
// a chunk whose hash no longer exists on the server → Vite fires
// `vite:preloadError`. Reload once to fetch the fresh index.html + new chunks.
// A sessionStorage guard prevents an infinite reload loop if it ever persists.
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem('bp:preload-reloaded')) return
  sessionStorage.setItem('bp:preload-reloaded', '1')
  window.location.reload()
})
window.addEventListener('load', () => sessionStorage.removeItem('bp:preload-reloaded'))

// Initialize auth before rendering (refresh token → access token)
useAuthStore.getState().initialize().then(() => {
  const root = document.getElementById('root')!
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <Toast />
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
})
