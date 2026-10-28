import { z } from "zod";
import { id, command, versioned } from "./primitives.js";

export const webhookTopics = [
  "order.created",
  "order.dispatched",
  "order.delivered",
  "inbound.received",
  "quality_hold.placed",
  "recall.initiated",
] as const;

export const webhookTopicEnum = z.enum(webhookTopics);

export const notificationEndpointCreate = command.extend({
  url: z.string().url().max(1000),
  eventTopics: z.array(webhookTopicEnum).min(1).max(20),
  secret: z.string().min(16).max(128).optional(),
  description: z.string().max(255).optional(),
  active: z.boolean().default(true),
});

export const notificationEndpointUpdate = versioned.extend({
  url: z.string().url().max(1000).optional(),
  eventTopics: z.array(webhookTopicEnum).min(1).max(20).optional(),
  secret: z.string().min(16).max(128).optional(),
  active: z.boolean().optional(),
  reason: z.string().min(3).max(500),
});

export const notificationTestPing = command.extend({
  endpointId: id,
});
