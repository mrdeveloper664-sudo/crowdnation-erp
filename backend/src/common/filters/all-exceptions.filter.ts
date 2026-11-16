import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Centralised error handling -> { success:false, error:{ code, message, details } } */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      message = typeof body === 'string' ? body : Array.isArray(body?.message) ? 'Validation failed' : body?.message ?? exception.message;
      if (Array.isArray(body?.message)) details = body.message;
      code = body?.code ?? HttpStatus[status] ?? 'ERROR';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT; code = 'CONFLICT'; message = 'A record with the same unique value already exists';
        details = exception.meta;
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND; code = 'NOT_FOUND'; message = 'Record not found';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT; code = 'REFERENCE_ERROR'; message = 'Record is referenced by other data';
      } else {
        this.logger.error(exception.message);
      }
    } else if (exception instanceof Error && /Unbalanced journal|immutable|Accounting period is locked|outside the accounting period/.test(exception.message)) {
      // raised by database integrity triggers - surface as a business-rule violation
      status = HttpStatus.UNPROCESSABLE_ENTITY; code = 'ACCOUNTING_RULE_VIOLATION'; message = exception.message.split('\n')[0];
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({ success: false, error: { code, message, details }, path: req.url, timestamp: new Date().toISOString() });
  }
}
