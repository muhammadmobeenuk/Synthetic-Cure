import "../../scripts/env.js";
process.env.NODE_ENV = "production";
await import("./server.js");
