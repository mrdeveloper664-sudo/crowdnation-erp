import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageDriver } from './storage';

/** S3-compatible object storage (AWS S3, DigitalOcean Spaces, MinIO ...). Env: S3_BUCKET, S3_REGION, S3_ENDPOINT, standard AWS credentials. */
export class S3Storage implements StorageDriver {
  constructor(
    private readonly client: Pick<S3Client, 'send'> = new S3Client({ region: process.env.S3_REGION ?? 'us-east-1', endpoint: process.env.S3_ENDPOINT, forcePathStyle: !!process.env.S3_ENDPOINT }),
    private readonly bucket = process.env.S3_BUCKET ?? '',
  ) {
    if (!this.bucket) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
  }

  private safe(key: string) {
    if (key.includes('..') || key.startsWith('/')) throw new Error('Invalid storage key');
    return key;
  }

  async put(key: string, data: Buffer) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.safe(key), Body: data, ServerSideEncryption: 'AES256' }));
  }

  async get(key: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.safe(key) }));
    const bytes = await (r.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.safe(key) }));
  }
}
