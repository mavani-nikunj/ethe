import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth';
import { PRODUCT_NAME } from '@ethesis/shared';
import { installErrorReporter, reportClientError } from './errorReporter';
import './styles.css';

document.title = PRODUCT_NAME;
installErrorReporter();

// After a deploy, an open tab still references old hashed chunks that no longer exist.
// Reload once to pick up the new index.html; the sessionStorage guard prevents reload loops.
const CHUNK_RELOAD_KEY = 'chunk-reload-at';
const isChunkLoadError = (error: unknown) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    String((error as Error)?.message ?? error),
  );
function reloadForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (Date.now() - last < 10_000) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForStaleChunk()) event.preventDefault();
});

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) reloadForStaleChunk();
    else reportClientError({ kind: 'crash', message: error.message, stack: error.stack });
  }
  render() {
    if (this.state.error) {
      return (
        <div className="main">
          <h1>{PRODUCT_NAME} failed to load</h1>
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--danger)' }}>{this.state.error.stack || this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </RootErrorBoundary>
  </React.StrictMode>,
);
