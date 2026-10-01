import { createBrowserRouter, Navigate, useParams } from 'react-router';
import { StudioLayout } from '@/features/studio/StudioLayout';
import { HomePage } from '@/features/home/HomePage';
import { ServicesPage } from '@/features/services/ServicesPage';
import { MyBookingPage } from '@/features/my-booking/MyBookingPage';
import { studioPath } from '@/features/studio/paths';
import { NotFoundPage, RootPage } from './RootPage';

// Unknown pages inside a studio lead to that studio's home, not to the site root.
function StudioFallback() {
  const { slug = '' } = useParams();
  return <Navigate to={studioPath(slug)} replace />;
}

export const router = createBrowserRouter([
  { path: '/', element: <RootPage /> },
  {
    path: '/s/:slug',
    element: <StudioLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'services', element: <ServicesPage /> },
      { path: 'my', element: <MyBookingPage /> },
    ],
  },
  {
    path: '/s/:slug/owner/*',
    lazy: async () => {
      const { OwnerApp } = await import('@/features/owner/OwnerApp');
      return { Component: OwnerApp };
    },
  },
  { path: '/s/:slug/*', element: <StudioFallback /> },
  { path: '*', element: <NotFoundPage /> },
]);
