import { Module } from "@nestjs/common";
import { NumbersModule } from "../numbers/numbers.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { LiveKitService } from "./livekit.service";
import { RuntimeController, RuntimeGuard, TestCallsController } from "./voice.controller";
import { VoiceService } from "./voice.service";

@Module({ imports: [IntegrationsModule, NumbersModule], controllers: [TestCallsController, RuntimeController], providers: [VoiceService, LiveKitService, RuntimeGuard] })
export class VoiceModule {}
