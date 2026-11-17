import { BadRequestException, Controller, Inject, Delete, Get, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'crypto';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { LocalStorage, StorageDriver } from './storage';

const MAX = 10 * 1024 * 1024;
const ENTITIES: Record<string, string> = { voucher: 'voucher', employee: 'hr', expense: 'expense', document: 'sales', asset: 'asset', project: 'project', lead: 'crm' };
// declared type -> required magic bytes (content sniffing; the client-declared mime is never trusted)
const SIGNATURES: Array<{ mime: string; ext: string[]; test: (b: Buffer) => boolean }> = [
  { mime: 'application/pdf', ext: ['pdf'], test: (b) => b.subarray(0, 4).toString() === '%PDF' },
  { mime: 'image/png', ext: ['png'], test: (b) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' },
  { mime: 'image/jpeg', ext: ['jpg', 'jpeg'], test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: ['xlsx'], test: (b) => b.subarray(0, 2).toString() === 'PK' },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: ['docx'], test: (b) => b.subarray(0, 2).toString() === 'PK' },
  { mime: 'text/csv', ext: ['csv', 'txt'], test: (b) => !b.includes(0) },
];

@Controller('attachments')
export class AttachmentsController {
  constructor(private prisma: PrismaService, @Inject(LocalStorage) private storage: StorageDriver, private audit: AuditService) {}

  @Post() @RequirePermission('voucher', 'create')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX, files: 1 } }))
  async upload(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File, @Query('entityType') entityType: string, @Query('entityId', ParseUUIDPipe) entityId: string) {
    if (!file) throw new BadRequestException('file is required');
    if (!ENTITIES[entityType]) throw new BadRequestException('Unsupported entityType');
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    const sig = SIGNATURES.find((s) => s.ext.includes(ext));
    if (!sig || !sig.test(file.buffer)) throw new BadRequestException('File type not allowed or content does not match its extension');
    const safeName = file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const key = `${u.companyId}/${randomUUID()}.${ext}`;
    return this.prisma.tenant(u.companyId, async (tx) => {
      await this.storage.put(key, file.buffer);
      const a = await tx.attachment.create({ data: { companyId: u.companyId, entityType, entityId, fileName: safeName, mimeType: sig.mime, sizeBytes: file.size, sha256: createHash('sha256').update(file.buffer).digest('hex'), storageKey: key, uploadedBy: u.userId } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'attachment.uploaded', entityType, entityId, after: { file: safeName } });
      return { id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes };
    });
  }

  @Get() @RequirePermission('voucher', 'view')
  list(@CurrentUser() u: AuthUser, @Query('entityType') entityType: string, @Query('entityId', ParseUUIDPipe) entityId: string) {
    return this.prisma.tenant(u.companyId, (tx) => tx.attachment.findMany({ where: { entityType, entityId }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: 'desc' } }));
  }

  @Get(':id/download') @RequirePermission('voucher', 'view')
  async download(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const a = await this.prisma.tenant(u.companyId, (tx) => tx.attachment.findUnique({ where: { id } }));
    if (!a) throw new BadRequestException('Not found');
    res.set({ 'Content-Type': a.mimeType, 'Content-Disposition': `attachment; filename="${a.fileName}"`, 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(await this.storage.get(a.storageKey));
  }

  @Delete(':id') @RequirePermission('voucher', 'delete')
  async remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.prisma.tenant(u.companyId, async (tx) => { const x = await tx.attachment.findUniqueOrThrow({ where: { id } }); await tx.attachment.delete({ where: { id } }); await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'attachment.deleted', entityType: x.entityType, entityId: x.entityId, before: { file: x.fileName } }); return x; });
    await this.storage.delete(a.storageKey);
    return { deleted: true };
  }
}
