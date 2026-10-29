import 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection string of the database the tests run against. */
    dbUrl: string;
    /** A connection string to the server itself, where the drill may make its own throwaway databases. */
    adminUrl: string;
  }
}
