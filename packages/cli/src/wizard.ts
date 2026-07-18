/**
 * Back-compat re-exports. The interactive / one-shot setup lives in setup.ts
 * (`briven setup`). `briven dev` still imports runWizard from here.
 */

export {
  decideBranch,
  runWizard,
  runSetup,
  type Branch,
} from './setup.js';
