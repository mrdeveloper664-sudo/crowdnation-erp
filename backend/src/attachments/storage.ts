import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

/** Storage abstraction. The local-disk driver is used in development; an S3-compatible driver implements the same interface. */
export interface StorageDriver { put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer>; delete(key: string): Promise<void> }

@Injectable()
export class LocalStorage implements StorageDriver {
  private root = path.resolve(process.env.STORAGE_DIR ?? './storage');
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error('Invalid storage key'); // no path traversal
    return p;
  }
  async put(key: string, data: Buffer) { const p = this.resolve(key); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, data); }
  get(key: string) { return fs.readFile(this.resolve(key)); }
  async delete(key: string) { await fs.rm(this.resolve(key), { force: true }); }
}
