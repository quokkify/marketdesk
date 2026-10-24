// Marketplace views report `sandbox: true` while the OLX adapter runs in stub
// mode. Read structurally so any marketplace-like value can be checked.
export function isSandboxMarketplace(marketplace: object | null | undefined): boolean {
  return (marketplace as { sandbox?: unknown } | null | undefined)?.sandbox === true;
}

// True while any marketplace of the workspace runs in the OLX sandbox.
export function hasSandboxMarketplace(
  marketplaces: ReadonlyArray<object> | null | undefined,
): boolean {
  return (marketplaces ?? []).some(isSandboxMarketplace);
}
