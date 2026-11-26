// Background work (BullMQ on Redis): CSV imports and reading knowledge from
// the web. The API enqueues; a worker runs the processors (`pnpm worker`, or
// inside the API in development with WORKER_IN_PROCESS=true). Tests set
// JOBS_INLINE=true and jobs run straight away, without Redis.

import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import { ENV, type Env } from "../../config/env";

export type JobName = "import-contacts" | "ingest-knowledge";
export type Processor = (data: Record<string, string>) => Promise<void>;

const QUEUE = "platform-jobs";

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Jobs");
  private readonly processors = new Map<JobName, Processor>();
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly inline = process.env.JOBS_INLINE === "true";

  constructor(@Inject(ENV) private readonly env: Env) {}

  register(name: JobName, processor: Processor): void {
    this.processors.set(name, processor);
  }

  private connection() {
    const url = new URL(this.env.REDIS_URL);
    return { host: url.hostname, port: Number(url.port || 6379), db: Number(url.pathname.slice(1) || 0), password: url.password || undefined, maxRetriesPerRequest: null };
  }

  onModuleInit(): void {
    if (this.inline) return;
    this.queue = new Queue(QUEUE, { connection: this.connection(), prefix: this.env.REDIS_PREFIX });
    if (this.env.WORKER_IN_PROCESS === "true") this.startWorker();
  }

  /** Runs the processors (the worker process calls this; the API does in development). */
  startWorker(): void {
    if (this.worker || this.inline) return;
    this.worker = new Worker(QUEUE, (job: Job) => this.run(job.name as JobName, job.data as Record<string, string>), { connection: this.connection(), prefix: this.env.REDIS_PREFIX, concurrency: 4 });
    this.worker.on("failed", (job, err) => this.log.error(`${job?.name} ${job?.id} failed: ${err.message}`));
    this.log.log("Worker started");
  }

  async enqueue(name: JobName, data: Record<string, string>, jobId?: string): Promise<void> {
    if (this.inline) return this.run(name, data);
    await this.queue!.add(name, data, { jobId, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 });
  }

  private async run(name: JobName, data: Record<string, string>): Promise<void> {
    const processor = this.processors.get(name);
    if (!processor) throw new Error(`No processor for ${name}`);
    await processor(data);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
