import request from "supertest";
import type { Express } from "express";
export async function inject(
  app: Express,
  {
    method = "GET",
    url = "/",
    body,
    headers = {},
  }: {
    method?: string;
    url?: string;
    body?: any;
    headers?: Record<string, string>;
  } = {},
) {
  let r = (request(app) as any)
    [method.toLowerCase()](url)
    .set(headers)
    .timeout({ response: 5000, deadline: 10000 });
  if (body !== undefined) r = r.send(body);
  const response = await r;
  return {
    status: response.status,
    body: response.body,
    headers: response.headers,
    raw: Buffer.from(response.text || ""),
  };
}
