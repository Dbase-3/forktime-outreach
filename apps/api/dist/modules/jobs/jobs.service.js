"use strict";
// Background work (BullMQ on Redis): CSV imports and reading knowledge from
// the web. The API enqueues; a worker runs the processors (`pnpm worker`, or
// inside the API in development with WORKER_IN_PROCESS=true). Tests set
// JOBS_INLINE=true and jobs run straight away, without Redis.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobsService = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("bullmq");
const env_1 = require("../../config/env");
const QUEUE = "platform-jobs";
let JobsService = class JobsService {
    env;
    log = new common_1.Logger("Jobs");
    processors = new Map();
    queue = null;
    worker = null;
    inline = process.env.JOBS_INLINE === "true";
    constructor(env) {
        this.env = env;
    }
    register(name, processor) {
        this.processors.set(name, processor);
    }
    connection() {
        const url = new URL(this.env.REDIS_URL);
        return { host: url.hostname, port: Number(url.port || 6379), db: Number(url.pathname.slice(1) || 0), password: url.password || undefined, maxRetriesPerRequest: null };
    }
    onModuleInit() {
        if (this.inline)
            return;
        this.queue = new bullmq_1.Queue(QUEUE, { connection: this.connection(), prefix: this.env.REDIS_PREFIX });
        if (this.env.WORKER_IN_PROCESS === "true")
            this.startWorker();
    }
    /** Runs the processors (the worker process calls this; the API does in development). */
    startWorker() {
        if (this.worker || this.inline)
            return;
        this.worker = new bullmq_1.Worker(QUEUE, (job) => this.run(job.name, job.data), { connection: this.connection(), prefix: this.env.REDIS_PREFIX, concurrency: 4 });
        this.worker.on("failed", (job, err) => this.log.error(`${job?.name} ${job?.id} failed: ${err.message}`));
        this.log.log("Worker started");
    }
    async enqueue(name, data, jobId) {
        if (this.inline)
            return this.run(name, data);
        await this.queue.add(name, data, { jobId, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 });
    }
    async run(name, data) {
        const processor = this.processors.get(name);
        if (!processor)
            throw new Error(`No processor for ${name}`);
        await processor(data);
    }
    async onModuleDestroy() {
        await this.worker?.close();
        await this.queue?.close();
    }
};
exports.JobsService = JobsService;
exports.JobsService = JobsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(env_1.ENV)),
    __metadata("design:paramtypes", [Object])
], JobsService);
//# sourceMappingURL=jobs.service.js.map