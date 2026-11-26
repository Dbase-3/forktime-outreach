import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { CampaignsController } from "./campaigns.controller";

@Module({ imports: [ContactsModule], controllers: [CampaignsController] })
export class CampaignsModule {}
