import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ENV, type Env } from "../config/env";
import { MODELS } from "./schemas";

const features = Object.entries(MODELS).map(([name, schema]) => ({ name, schema }));

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ uri: env.MONGODB_URI, autoIndex: true, serverSelectionTimeoutMS: 8000 }),
    }),
    MongooseModule.forFeature(features),
  ],
  exports: [MongooseModule],
})
export class DbModule {}
