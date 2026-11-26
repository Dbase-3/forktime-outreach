import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { Mailer } from "./mailer";

@Global()
@Module({ controllers: [AuthController], providers: [AuthService, Mailer], exports: [AuthService, Mailer] })
export class AuthModule {}
