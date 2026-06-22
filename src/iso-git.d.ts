// Types for the vendored, bundled isomorphic-git browser ESM. We declare only
// the functions we use, with a pragmatic `fs: any` (our in-memory FS satisfies
// isomorphic-git at runtime; see repo.ts). The runtime module lives at
// public/vendor/isomorphic-git.mjs.
declare module "*/vendor/isomorphic-git.mjs" {
  interface GitFs { promises: unknown }
  interface Common { fs: GitFs; dir: string }
  interface Author { name: string; email: string; timestamp?: number; timezoneOffset?: number }
  export function init(a: Common & { defaultBranch?: string }): Promise<void>;
  export function add(a: Common & { filepath: string }): Promise<void>;
  export function remove(a: Common & { filepath: string }): Promise<void>;
  export function commit(a: Common & { message: string; author: Author }): Promise<string>;
  export function statusMatrix(a: Common & { filepaths?: string[] }): Promise<Array<[string, number, number, number]>>;
  export function log(a: Common & { depth?: number; ref?: string }): Promise<Array<{ oid: string; commit: { message: string; tree: string; parent: string[] } }>>;
  export function listFiles(a: Common & { ref?: string }): Promise<string[]>;
  export function currentBranch(a: Common & { fullname?: boolean }): Promise<string | void>;
}
