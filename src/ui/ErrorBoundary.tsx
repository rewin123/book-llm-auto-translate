import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Last resort so one thrown error does not leave the reader a blank page.
 *
 * A translation run holds the book, the glossary and every finished chunk in
 * memory, so an unhandled throw used to cost all of it with nothing on screen to
 * explain why. Reloading recovers the work from the IndexedDB checkpoint, which
 * is what the message points at.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="crash" role="alert">
        <h1>Something broke</h1>
        <p>
          Reload the page to continue — a translation already in progress is restored from its
          checkpoint.
        </p>
        <button type="button" onClick={() => location.reload()}>
          Reload
        </button>
        <pre>{error.message}</pre>
      </main>
    );
  }
}
