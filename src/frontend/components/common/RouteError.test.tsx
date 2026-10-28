import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import {
  MemoryRouter,
  StaticRouterProvider,
  createStaticHandler,
  createStaticRouter,
  type RouteObject,
} from 'react-router-dom';
import { lightTheme } from '../../theme/lightTheme';
import { textOf } from '../../testkit/staticMarkup';
import {
  RouteError,
  RouteErrorView,
  describeRouteError,
  type RouteErrorViewProps,
} from './RouteError';

// Renders the route's errorElement the way the router does when a loader throws.
async function renderRouteFailure(thrown: unknown): Promise<string> {
  const routes: RouteObject[] = [
    {
      path: '/',
      loader: () => {
        throw thrown;
      },
      element: <p>page</p>,
      errorElement: <RouteError />,
    },
  ];
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request('http://localhost/'));
  if (context instanceof Response) throw new Error('Expected the route to fail');
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(
    <ThemeProvider theme={lightTheme}>
      <StaticRouterProvider router={router} context={context} hydrate={false} />
    </ThemeProvider>
  );
}

type ElementProps = { children?: React.ReactNode; onClick?: () => void };

function findElement(
  node: React.ReactNode,
  matches: (element: React.ReactElement<ElementProps>) => boolean
): React.ReactElement<ElementProps> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, matches);
      if (found) return found;
    }
    return undefined;
  }
  if (!React.isValidElement<ElementProps>(node)) return undefined;
  return matches(node) ? node : findElement(node.props.children, matches);
}

describe('RouteError', () => {
  it('renders reload action and a way back to the dashboard', async () => {
    const html = await renderRouteFailure(new Error('chunk failed'));

    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain('Something went wrong');
    expect(html).toMatch(/<button[^>]*>.*Reload<\/button>/);
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Back to dashboard<\/a>/);
    expect(textOf(html)).toContain('chunk failed');
  });

  it('carries the MarketDesk brand mark', async () => {
    const html = await renderRouteFailure(new Error('boom'));

    expect(html).toContain('src="/marketdesk-mark.svg"');
  });

  it('names the status of a router error response', async () => {
    const html = await renderRouteFailure(
      new Response('Missing', { status: 404, statusText: 'Not Found' })
    );

    expect(textOf(html)).toContain('404 Not Found');
  });
});

describe('describeRouteError', () => {
  it.each([
    [new Error('boom'), 'boom'],
    [new Error(''), undefined],
    ['plain text', undefined],
    [undefined, undefined],
    [{ status: 403, statusText: 'Forbidden', internal: false, data: null }, '403 Forbidden'],
  ])('summarises %p as %p', (error, expected) => {
    expect(describeRouteError(error)).toBe(expected);
  });
});

describe('RouteErrorView', () => {
  // The view has no hooks, so calling it yields its element tree.
  const reloadButtonOf = (props: RouteErrorViewProps) =>
    findElement(
      RouteErrorView(props) as React.ReactElement,
      (element) => element.props.children === 'Reload'
    );

  it('runs the reload action when Reload is pressed', () => {
    const onReload = jest.fn();

    reloadButtonOf({ onReload })?.props.onClick?.();

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('reloads the window when no reload action is given', () => {
    const reload = jest.fn();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { reload } },
    });

    try {
      reloadButtonOf({})?.props.onClick?.();
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('fills the viewport only when it replaces the whole page', () => {
    const html = (fullPage: boolean) =>
      renderToStaticMarkup(
        <ThemeProvider theme={lightTheme}>
          <MemoryRouter>
            <RouteErrorView fullPage={fullPage} />
          </MemoryRouter>
        </ThemeProvider>
      );

    expect(html(true)).toContain('min-height:100vh');
    expect(html(false)).not.toContain('min-height:100vh');
  });
});
