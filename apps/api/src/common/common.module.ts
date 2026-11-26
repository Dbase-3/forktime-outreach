import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ErrorFilter } from "./error.filter";
import { AuthGuard, WorkspaceGuard } from "./guards";

@Global()
@Module({
  providers: [
    AuthGuard,
    WorkspaceGuard,
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useExisting: WorkspaceGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
  exports: [WorkspaceGuard],
})
export class CommonModule {}
