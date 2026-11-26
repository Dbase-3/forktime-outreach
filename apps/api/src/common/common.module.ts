import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ErrorFilter } from "./error.filter";
import { AuthGuard, WorkspaceGuard } from "./guards";
import { KnowledgeIndex } from "./knowledge-index";
import { WorkspaceData } from "./workspace-data";

@Global()
@Module({
  providers: [
    AuthGuard,
    WorkspaceGuard,
    WorkspaceData,
    KnowledgeIndex,
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useExisting: WorkspaceGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
  exports: [WorkspaceGuard, WorkspaceData, KnowledgeIndex],
})
export class CommonModule {}
