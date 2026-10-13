import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { routeObjects } from './app/router.jsx';
import { createQueryClient } from './shared/queryClient.js';
import { initTelemetry } from './shared/telemetry.js';
import './styles/index.css';

void initTelemetry();

const router = createBrowserRouter(routeObjects);
const queryClient = createQueryClient();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
