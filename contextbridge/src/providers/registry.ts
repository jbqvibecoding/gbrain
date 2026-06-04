/**
 * Provider registry — toolkit slug → {@link ProviderAdapter}.
 *
 * Mirrors OpenHuman's `providers/registry.rs` `get_provider(toolkit)`. The
 * puller looks an adapter up per active connection; toolkits without an adapter
 * are skipped by the pull loop (their typed tools still work via execute).
 */

import { GmailAdapter } from './gmail.ts';
import { buildGenericAdapters } from './generic.ts';
import type { ProviderAdapter } from './types.ts';

export class ProviderRegistry {
  private readonly byToolkit = new Map<string, ProviderAdapter>();

  constructor(adapters: ProviderAdapter[]) {
    for (const a of adapters) this.byToolkit.set(a.toolkit, a);
  }

  /** The default bundle: Gmail (bespoke) + the generic adapters. */
  static default(): ProviderRegistry {
    return new ProviderRegistry([new GmailAdapter(), ...buildGenericAdapters()]);
  }

  get(toolkit: string): ProviderAdapter | undefined {
    return this.byToolkit.get(toolkit.toLowerCase());
  }

  has(toolkit: string): boolean {
    return this.byToolkit.has(toolkit.toLowerCase());
  }

  toolkits(): string[] {
    return [...this.byToolkit.keys()];
  }

  /** Register / override an adapter (products can plug their own). */
  register(adapter: ProviderAdapter): void {
    this.byToolkit.set(adapter.toolkit, adapter);
  }
}
