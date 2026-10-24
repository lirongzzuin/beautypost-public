import {
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { useAuthStore } from '~/store/auth'
import { BottomNav } from '~/components/BottomNav'
import { PageLoader } from '~/components/PageLoader'

// Lazy-loaded screens
const LoginPage = lazy(() => import('~/pages/LoginPage'))
const VerifyPage = lazy(() => import('~/pages/VerifyPage'))
const OnboardingPage = lazy(() => import('~/pages/OnboardingPage'))
const DashboardPage = lazy(() => import('~/pages/DashboardPage'))
const CreateContentPage = lazy(() => import('~/pages/create/CreateContentPage'))
const LibraryPage = lazy(() => import('~/pages/LibraryPage'))
const BrandSettingsPage = lazy(() => import('~/pages/BrandSettingsPage'))
const CalendarPage = lazy(() => import('~/pages/CalendarPage'))
const PostsPage = lazy(() => import('~/pages/PostsPage'))
const PostDetailPage = lazy(() => import('~/pages/PostDetailPage'))
const CustomersPage = lazy(() => import('~/pages/CustomersPage'))
const CustomerDetailPage = lazy(() => import('~/pages/CustomerDetailPage'))
const NotificationsPage = lazy(() => import('~/pages/NotificationsPage'))
const SettingsPage = lazy(() => import('~/pages/SettingsPage'))
const ChannelsPage = lazy(() => import('~/pages/ChannelsPage'))
const ProfilePage = lazy(() => import('~/pages/ProfilePage'))

// ─── Root layout ──────────────────────────────────────────────────────────────

const rootRoute = createRootRoute({
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <Outlet />
    </Suspense>
  ),
})

// ─── Auth guard layout ────────────────────────────────────────────────────────

const authLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth-layout',
  beforeLoad: () => {
    const { user, isLoading } = useAuthStore.getState()
    if (!isLoading && !user) {
      throw redirect({ to: '/auth/login' })
    }
  },
  component: () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Outlet />
      <BottomNav />
    </div>
  ),
})

// ─── Public routes ────────────────────────────────────────────────────────────

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/login',
  component: () => <LoginPage />,
})

const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/verify',
  component: () => <VerifyPage />,
})

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: () => <OnboardingPage />,
})

// ─── Protected routes ─────────────────────────────────────────────────────────

const dashboardRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/',
  component: () => <DashboardPage />,
})

const createPostRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/posts/create',
  component: () => <CreateContentPage />,
})

const postsRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/posts',
  component: () => <PostsPage />,
})

const postDetailRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/posts/$postId',
  component: () => <PostDetailPage />,
})

const calendarRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/calendar',
  component: () => <CalendarPage />,
})

const customersRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/customers',
  component: () => <CustomersPage />,
})

const customerDetailRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/customers/$customerId',
  component: () => <CustomerDetailPage />,
})

const notificationsRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/notifications',
  component: () => <NotificationsPage />,
})

const settingsRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/settings',
  component: () => <SettingsPage />,
})

const channelsRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/settings/channels',
  component: () => <ChannelsPage />,
})

const libraryRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/library',
  component: () => <LibraryPage />,
})

const brandRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/settings/brand',
  component: () => <BrandSettingsPage />,
})

const profileRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/settings/profile',
  component: () => <ProfilePage />,
})

// ─── Router ───────────────────────────────────────────────────────────────────

const routeTree = rootRoute.addChildren([
  loginRoute,
  verifyRoute,
  onboardingRoute,
  authLayout.addChildren([
    dashboardRoute,
    createPostRoute,
    postsRoute,
    postDetailRoute,
    calendarRoute,
    customersRoute,
    customerDetailRoute,
    notificationsRoute,
    settingsRoute,
    channelsRoute,
    profileRoute,
    libraryRoute,
    brandRoute,
  ]),
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
