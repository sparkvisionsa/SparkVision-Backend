declare module "@nestjs/config" {
  import type { DynamicModule } from "@nestjs/common";

  export interface ConfigModuleOptions {
    isGlobal?: boolean;
    envFilePath?: string | string[];
    [key: string]: unknown;
  }

  export class ConfigModule {
    static forRoot(options?: ConfigModuleOptions): DynamicModule;
  }
}

declare module "@nestjs/throttler" {
  import type {
    CanActivate,
    DynamicModule,
    ExecutionContext,
  } from "@nestjs/common";

  export interface ThrottlerOptions {
    ttl?: number;
    limit?: number;
    name?: string;
    [key: string]: unknown;
  }

  export class ThrottlerModule {
    static forRoot(
      options?: ThrottlerOptions | ThrottlerOptions[],
    ): DynamicModule;
  }

  export class ThrottlerGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean | Promise<boolean>;
  }
}
