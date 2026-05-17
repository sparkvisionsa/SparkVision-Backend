import { Injectable } from "@nestjs/common";
import type { Response } from "express";

export type MvRealtimeEventType =
  | "asset-folders-changed"
  | "asset-images-changed";

export type MvRealtimeEvent = {
  type: MvRealtimeEventType;
  projectId: string;
  reason: string;
  at: string;
};

type Client = {
  id: string;
  response: Response;
  heartbeat: NodeJS.Timeout;
};

@Injectable()
export class MvRealtimeService {
  private readonly clientsByProject = new Map<string, Map<string, Client>>();

  subscribe(projectId: string, response: Response) {
    const normalizedProjectId = projectId.trim();
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    let clients = this.clientsByProject.get(normalizedProjectId);
    if (!clients) {
      clients = new Map<string, Client>();
      this.clientsByProject.set(normalizedProjectId, clients);
    }

    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    const write = (event: string, data: unknown) => {
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    write("ready", {
      type: "ready",
      projectId: normalizedProjectId,
      at: new Date().toISOString(),
    });

    const heartbeat = setInterval(() => {
      if (response.writableEnded) return;
      response.write(`: keep-alive ${Date.now()}\n\n`);
    }, 25_000);

    const client: Client = { id, response, heartbeat };
    clients.set(id, client);

    const cleanup = () => {
      clearInterval(heartbeat);
      const bucket = this.clientsByProject.get(normalizedProjectId);
      bucket?.delete(id);
      if (bucket && bucket.size === 0) this.clientsByProject.delete(normalizedProjectId);
    };

    response.on("close", cleanup);
    response.on("finish", cleanup);
  }

  publish(projectId: string, type: MvRealtimeEventType, reason: string) {
    const normalizedProjectId = projectId.trim();
    const clients = this.clientsByProject.get(normalizedProjectId);
    if (!clients || clients.size === 0) return;

    const event: MvRealtimeEvent = {
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
      } catch {
        clearInterval(client.heartbeat);
        clients.delete(client.id);
      }
    }

    if (clients.size === 0) this.clientsByProject.delete(normalizedProjectId);
  }
}
