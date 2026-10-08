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
