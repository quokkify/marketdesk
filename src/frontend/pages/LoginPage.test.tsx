import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { REGISTRATION_WORKSPACE_NAME_MAX_LENGTH } from '@shared/constants';
import LoginPage, { WorkspaceNameField } from './LoginPage';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
}));

jest.mock('../state/hooks.js', () => ({
  useAppDispatch: () => jest.fn(),
}));

jest.mock('../services/hooks/index.js', () => ({
  useLogin: () => [jest.fn(), { isLoading: false }],
  useRegister: () => [jest.fn(), { isLoading: false }],
}));

describe('LoginPage registration', () => {
  it('marks Workspace name required and capped at the server limit', () => {
    const html = renderToStaticMarkup(<WorkspaceNameField value="" onChange={jest.fn()} />);
    const input = html.match(/<input[^>]*>/)?.[0] ?? '';

    expect(html).toContain('Workspace name');
    expect(input).toMatch(/\brequired=""/);
    // React serialises the attribute as maxLength; HTML attribute names are case-insensitive.
    expect(input).toMatch(new RegExp(`maxlength="${REGISTRATION_WORKSPACE_NAME_MAX_LENGTH}"`, 'i'));
  });
});

describe('LoginPage sign-in', () => {
  it('does not ask for a workspace name', () => {
    const html = renderToStaticMarkup(<LoginPage />);

    expect(html).toContain('Welcome back to MarketDesk.');
    expect(html).not.toContain('Workspace name');
  });
});
