import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouteErrorView } from './RouteError';
import { RouteErrorBoundary } from './RouteErrorBoundary';

const failure = new Error('page crashed');
const page = <p>page</p>;

function mountBoundary(resetKey = 'visit-1') {
  return new RouteErrorBoundary({ resetKey, children: page });
}

describe('RouteErrorBoundary', () => {
  it('renders the page while nothing has failed', () => {
    expect(mountBoundary().render()).toBe(page);
    expect(
      renderToStaticMarkup(<RouteErrorBoundary resetKey="visit-1">{page}</RouteErrorBoundary>)
    ).toBe('<p>page</p>');
  });

  it('swaps a crashed page for the branded error view', () => {
    const boundary = mountBoundary();
    const failed = RouteErrorBoundary.getDerivedStateFromError(failure);
    expect(failed).toEqual({ hasError: true, error: failure });

    boundary.state = { ...boundary.state, ...failed };
    const fallback = boundary.render() as React.ReactElement<{ error: unknown }>;

    expect(fallback.type).toBe(RouteErrorView);
    expect(fallback.props.error).toBe(failure);
  });

  it('keeps showing the error view while the location stays the same', () => {
    const crashed = { hasError: true, error: failure, resetKey: 'visit-1' };

    expect(
      RouteErrorBoundary.getDerivedStateFromProps({ resetKey: 'visit-1', children: page }, crashed)
    ).toBeNull();
  });

  it('recovers when the user navigates, so the shell is not stuck on the error', () => {
    const crashed = { hasError: true, error: failure, resetKey: 'visit-1' };

    expect(
      RouteErrorBoundary.getDerivedStateFromProps({ resetKey: 'visit-2', children: page }, crashed)
    ).toEqual({ hasError: false, error: undefined, resetKey: 'visit-2' });
  });

  it('reports the crash to the console instead of swallowing it', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      mountBoundary().componentDidCatch(failure, { componentStack: '\n    at Page' });

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringMatching(/crashed/i),
        failure,
        '\n    at Page'
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
