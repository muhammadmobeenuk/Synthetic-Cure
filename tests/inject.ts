import request from "supertest";
import type { Express } from "express";
export async function inject(
  app: Express,
  {
    method = "GET",
    url = "/",
    body,
    headers = {},
    binary = false,
  }: {
    method?: string;
    url?: string;
    body?: any;
    headers?: Record<string, string>;
    binary?: boolean;
  } = {},
) {
  let r = (request(app) as any)
    [method.toLowerCase()](url)
    .set(headers)
    .timeout({ response: 5000, deadline: 10000 });
  if (binary) {
    r = r.buffer(true).parse((res: any, cb: any) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  }
  if (body !== undefined) r = r.send(body);
  const response = await r;
  return {
    status: response.status,
    body: response.body,
    headers: response.headers,
    raw: binary && Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.text || ""),
  };
}
