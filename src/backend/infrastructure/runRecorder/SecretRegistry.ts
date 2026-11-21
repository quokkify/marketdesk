const MIN_SECRET_LENGTH = 8;
const ENV_LABEL_PREFIX = 'ENV:';
export const MAX_REGISTERED_SECRETS = 512;

export class SecretRegistry {
  private readonly labels = new Map<string, string>();
  private longestFirst: string[] | undefined;

  get size(): number {
    return this.labels.size;
  }

  register(value: string | undefined | null, label: string): void {
    if (typeof value !== 'string' || value.length < MIN_SECRET_LENGTH) return;
    if (this.labels.has(value)) return;
    if (this.labels.size >= MAX_REGISTERED_SECRETS && !this.evictOldestRuntime()) return;
    this.labels.set(value, label);
    this.longestFirst = undefined;
  }

  scrub(text: string): string {
    this.longestFirst ??= [...this.labels.keys()].sort((a, b) => b.length - a.length);
    let result = text;
    for (const value of this.longestFirst) {
      result = result.split(value).join(`[${this.labels.get(value)}]`);
    }
    return result;
  }

  private evictOldestRuntime(): boolean {
    for (const [value, label] of this.labels) {
      if (!label.startsWith(ENV_LABEL_PREFIX)) {
        this.labels.delete(value);
        return true;
      }
    }
    return false;
  }
}

export const secretRegistry = new SecretRegistry();
