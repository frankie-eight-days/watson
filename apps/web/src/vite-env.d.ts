/// <reference types="vite/client" />

// Raw import of the fixture JSONL (single source of truth, never copied).
declare module '*.jsonl?raw' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
