// Ambient declarations for non-code assets imported for their side effects.
// Next.js processes these at build time; this lets TypeScript/the editor resolve
// the import instead of erroring ("Cannot find module ... .css").
declare module "*.css";
