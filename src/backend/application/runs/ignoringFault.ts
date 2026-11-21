export function ignoringFault(action: () => void): void {
  try {
    action();
  } catch {
    // a recorder fault must never reach the caller
  }
}
