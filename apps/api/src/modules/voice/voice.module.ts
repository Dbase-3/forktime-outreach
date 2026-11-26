import { Module } from "@nestjs/common";
import { LiveKitService } from "./livekit.service";
import { RuntimeController, RuntimeGuard, TestCallsController } from "./voice.controller";
import { VoiceService } from "./voice.service";

@Module({ controllers: [TestCallsController, RuntimeController], providers: [VoiceService, LiveKitService, RuntimeGuard] })
export class VoiceModule {}
