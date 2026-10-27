import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
export interface PrivateStorage {
  write(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export class LocalPrivateStorage implements PrivateStorage {
  constructor(private root: string) {}
  private filename(key: string) {
    if (!/^[a-f0-9-]+$/.test(key))
      throw new Error("Invalid private storage key");
    return path.join(this.root, key);
  }
  async write(key: string, bytes: Buffer) {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.filename(key), bytes, { mode: 0o600 });
  }
  read(key: string) {
    return readFile(this.filename(key));
  }
  remove(key: string) {
    return unlink(this.filename(key));
  }
}
