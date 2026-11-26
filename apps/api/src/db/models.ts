// Typed handles for injecting models: `constructor(@InjectModel("Agent") agents: M<"Agent">)`.
import type { HydratedDocument, Model } from "mongoose";
import type { InferSchemaType } from "mongoose";
import type { MODELS, ModelName } from "./schemas";

export type Row<N extends ModelName> = InferSchemaType<(typeof MODELS)[N]> & { _id: import("mongoose").Types.ObjectId; createdAt: Date; updatedAt: Date };
export type M<N extends ModelName> = Model<Row<N>>;
export type D<N extends ModelName> = HydratedDocument<Row<N>>;
