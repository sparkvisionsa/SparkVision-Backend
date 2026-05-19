"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MvRealtimeService = void 0;
const common_1 = require("@nestjs/common");
let MvRealtimeService = class MvRealtimeService {
    constructor() {
        this.clientsByProject = new Map();
    }
    subscribe(projectId, response) {
        const normalizedProjectId = projectId.trim();
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        let clients = this.clientsByProject.get(normalizedProjectId);
        if (!clients) {
            clients = new Map();
            this.clientsByProject.set(normalizedProjectId, clients);
        }
        response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache, no-transform");
        response.setHeader("Connection", "keep-alive");
        response.setHeader("X-Accel-Buffering", "no");
        response.flushHeaders?.();
        const write = (event, data) => {
            response.write(`event: ${event}\n`);
            response.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        write("ready", {
            type: "ready",
            projectId: normalizedProjectId,
            at: new Date().toISOString(),
        });
        const heartbeat = setInterval(() => {
            if (response.writableEnded)
                return;
            response.write(`: keep-alive ${Date.now()}\n\n`);
        }, 25_000);
        const client = { id, response, heartbeat };
        clients.set(id, client);
        const cleanup = () => {
            clearInterval(heartbeat);
            const bucket = this.clientsByProject.get(normalizedProjectId);
            bucket?.delete(id);
            if (bucket && bucket.size === 0)
                this.clientsByProject.delete(normalizedProjectId);
        };
        response.on("close", cleanup);
        response.on("finish", cleanup);
    }
    publish(projectId, type, reason) {
        const normalizedProjectId = projectId.trim();
        const clients = this.clientsByProject.get(normalizedProjectId);
        if (!clients || clients.size === 0)
            return;
        const event = {
            type,
            projectId: normalizedProjectId,
            reason,
            at: new Date().toISOString(),
        };
        for (const client of clients.values()) {
            if (client.response.writableEnded) {
                clients.delete(client.id);
                continue;
            }
            try {
                client.response.write(`event: ${type}\n`);
                client.response.write(`data: ${JSON.stringify(event)}\n\n`);
            }
            catch {
                clearInterval(client.heartbeat);
                clients.delete(client.id);
            }
        }
        if (clients.size === 0)
            this.clientsByProject.delete(normalizedProjectId);
    }
};
exports.MvRealtimeService = MvRealtimeService;
exports.MvRealtimeService = MvRealtimeService = __decorate([
    (0, common_1.Injectable)()
], MvRealtimeService);
