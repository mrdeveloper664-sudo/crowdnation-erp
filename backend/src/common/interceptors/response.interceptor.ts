import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map } from 'rxjs';

/** Wraps all successful responses: { success:true, data, meta? } */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map((payload) => {
        if (payload instanceof StreamableFile) return payload;
        if (payload && typeof payload === 'object' && '__paged' in payload) {
          return { success: true, data: payload.items, meta: payload.meta };
        }
        return { success: true, data: payload ?? null };
      }),
    );
  }
}

export function paged<T>(items: T[], page: number, pageSize: number, total: number) {
  return { __paged: true, items, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}
