import React from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { RouteError } from './components/common/RouteError';
import { AppShell } from './components/layout/AppShell';
import './App';

// App.tsx builds its browser router at import time; hand it a memory router so the
// route table can be inspected without a DOM.
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    createBrowserRouter: jest.fn((routes: RouteObject[]) => actual.createMemoryRouter(routes)),
  };
});

const routes = (createBrowserRouter as jest.Mock).mock.calls[0][0] as RouteObject[];

function findRoute(
  candidates: RouteObject[],
  matches: (route: RouteObject) => boolean
): RouteObject | undefined {
  for (const route of candidates) {
    if (matches(route)) return route;
    const nested = route.children && findRoute(route.children, matches);
    if (nested) return nested;
  }
  return undefined;
}

const isRouteError = (element: React.ReactNode) =>
  React.isValidElement(element) && element.type === RouteError;

describe('app routes', () => {
  it('replaces the router default error screen at the root', () => {
    expect(isRouteError(routes[0].errorElement)).toBe(true);
  });

  it('shows the branded error when the app shell itself fails', () => {
    const shell = findRoute(
      routes,
      (route) => React.isValidElement(route.element) && route.element.type === AppShell
    );

    expect(isRouteError(shell?.errorElement)).toBe(true);
  });
});
