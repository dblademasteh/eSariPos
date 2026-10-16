import React from 'react';

// Catches render crashes and shows the reason instead of a white page.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface in console too, for copy/paste reports.
    console.error('[eSariPOS] Render error:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-2xl space-y-4 p-8">
          <h1 className="text-xl font-bold text-warn">This page hit an error</h1>
          <pre className="overflow-x-auto rounded-xl bg-panel p-4 text-sm whitespace-pre-wrap">
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <div className="flex gap-2">
            <button
              className="btn-cta"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              className="btn-outline"
              onClick={() => window.location.reload()}
            >
              Full reload
            </button>
          </div>
          <p className="text-xs opacity-60">
            If this repeats, copy the message above and send it over.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
