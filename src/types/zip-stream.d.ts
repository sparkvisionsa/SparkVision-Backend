declare module "zip-stream" {
  import { Transform } from "node:stream";

  export type ZipStreamOptions = {
    forceZip64?: boolean;
    store?: boolean;
    level?: number;
  };

  export type ZipEntryOptions = {
    name: string;
    type?: "file" | "directory" | "symlink";
    date?: Date;
    store?: boolean;
  };

  export default class ZipStream extends Transform {
    constructor(options?: ZipStreamOptions);
    entry(
      source: Buffer | NodeJS.ReadableStream | string | null,
      options: ZipEntryOptions,
      callback: (error: Error | null) => void,
    ): this | undefined;
    finalize(): void;
  }
}
