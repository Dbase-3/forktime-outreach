// Every error leaves in one shape: { error: { code, message, details? } }.
// Unexpected errors are logged and shown as a plain "something went wrong";
// a duplicate key becomes a 409 the screen can explain.

import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger("Error");

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof HttpException) {
      const body = err.getResponse();
      const shaped = typeof body === "object" && body && "error" in body ? body : { error: { code: "http_" + err.getStatus(), message: typeof body === "string" ? body : (body as { message?: string }).message ?? err.message } };
      return res.status(err.getStatus()).json(shaped);
    }
    if (typeof err === "object" && err && (err as { code?: number }).code === 11000) {
      return res.status(409).json({ error: { code: "duplicate", message: "That already exists.", details: (err as { keyValue?: unknown }).keyValue } });
    }
    this.log.error(err instanceof Error ? err.stack ?? err.message : String(err));
    return res.status(500).json({ error: { code: "server_error", message: "Something went wrong on our side. Try again." } });
  }
}
