// Configuration Vitest commune : résout les paquets internes vers leurs sources TS
// (condition d'export "@margeo/source") pour tester sans build préalable.
export const sharedVitestConfig = {
  resolve: { conditions: ['@margeo/source'] },
  ssr: { resolve: { conditions: ['@margeo/source'] } },
};
