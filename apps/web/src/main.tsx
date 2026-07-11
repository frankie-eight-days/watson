import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConvexProvider } from 'convex/react';
import { App } from './App';
import { convex } from './lib/convexClient';
import './index.css';

// The Convex provider is only mounted when a client exists (VITE_CONVEX_URL set).
// Offline builds render the fixture with no provider.
const tree = convex ? (
  <ConvexProvider client={convex}>
    <App />
  </ConvexProvider>
) : (
  <App />
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>{tree}</BrowserRouter>
  </StrictMode>,
);
