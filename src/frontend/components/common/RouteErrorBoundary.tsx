// Keeps the app shell alive when a routed page throws while rendering, or its lazy chunk fails
// to load: the page is replaced by the branded error view and the sidebar and top bar stay
// usable. `resetKey` is the router's location key, so any navigation retries the page.
import React from 'react';
import { RouteErrorView } from './RouteError.js';

interface RouteErrorBoundaryProps {
  resetKey: string;
  children: React.ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
  error: unknown;
  resetKey: string;
}

export class RouteErrorBoundary extends React.Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    hasError: false,
    error: undefined,
    resetKey: this.props.resetKey,
  };

  static getDerivedStateFromError(error: unknown): Partial<RouteErrorBoundaryState> {
    return { hasError: true, error };
  }

  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState
  ): Partial<RouteErrorBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return { hasError: false, error: undefined, resetKey: props.resetKey };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('A page crashed inside the app shell', error, info.componentStack);
  }

  render(): React.ReactNode {
    return this.state.hasError ? <RouteErrorView error={this.state.error} /> : this.props.children;
  }
}

export default RouteErrorBoundary;
