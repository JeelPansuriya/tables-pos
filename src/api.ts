// Typed wrapper around window.api (defined in electron/preload.ts).
// We assert the type rather than re-declare to avoid drift with the preload contract.

declare global {
  interface Window {
    api: any;
  }
}

export const api = (typeof window !== 'undefined' && (window as any).api) || ({} as any);

export {};
