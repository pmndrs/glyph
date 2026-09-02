import type { ThreeTextEngineCoordinator } from './engine-coordinator.js';

export interface ThreeEngineDomainLease {
  readonly coordinator: ThreeTextEngineCoordinator;
  retain(): ThreeEngineDomainLease;
  dispose(): void;
}

/** @internal Construction-time source for one handle-owned Three domain lease. */
export interface ThreeEngineDomainProvider {
  readonly coordinator: ThreeTextEngineCoordinator;
  acquire(): ThreeEngineDomainLease;
}
