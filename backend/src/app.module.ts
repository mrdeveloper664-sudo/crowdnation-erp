import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountingController } from './accounting/accounting.controller';
import { PeriodService } from './accounting/period.service';
import { PostingService } from './accounting/posting.service';
import { SequenceService } from './accounting/sequence.service';
import { AuthModule } from './auth/auth.module';
import { CoaController } from './chart-of-accounts/coa.controller';
import { AuditService } from './common/audit.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard, PermissionsGuard } from './common/guards/auth.guards';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { MailService } from './common/mail.service';
import { PermissionCatalogService } from './common/permission-catalog.service';
import { PrismaService } from './common/prisma.service';
import { CompaniesController } from './companies/companies.controller';
import { CompanyBootstrapService } from './companies/company-bootstrap.service';
import { LedgersController } from './ledgers/ledgers.controller';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { ReportExportService } from './reports/report-export.service';
import { AccessService } from './common/access.service';
import { VatController } from './vat/vat.controller';
import { VatService } from './vat/vat.service';
import { SystemAccountsService } from './accounting/system-accounts.service';
import { CustomersController, SuppliersController } from './trade/parties.controller';
import { DocumentsService } from './trade/documents.service';
import { InventoryHooks } from './trade/inventory.hooks';
import { SettlementsService } from './trade/settlements.service';
import { RecurringService } from './trade/recurring.service';
import { PurchaseDocumentsController, ReceiptsController, RecurringController, SalesDocumentsController, SupplierPaymentsController } from './trade/trade.controllers';
import { InventoryController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { InventoryReports } from './inventory/inventory-reports';
import { CrmController } from './crm/crm.controller';
import { HrController } from './hr/hr.controller';
import { ExpensesController } from './expenses/expenses.controller';
import { ProjectsController } from './projects/projects.controller';
import { AssetsController } from './assets/assets.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { AttachmentsController } from './attachments/attachments.controller';
import { LocalStorage } from './attachments/storage';
import { S3Storage } from './attachments/s3-storage';
import { JobsService } from './common/jobs.service';
import { NotificationsService } from './common/notifications.service';
import { NotificationsController } from './common/notifications.controller';
import { ModuleReports } from './reports/module-reports';
import { PrintController } from './reports/print.controller';
import { AuditController } from './audit/audit.controller';
import { JournalController } from './accounting/journal.controller';
import { UsersController } from './users/users.controller';
import { VouchersController } from './vouchers/vouchers.controller';
import { VouchersService } from './vouchers/vouchers.service';

@Global()
@Module({
  providers: [PrismaService, AuditService, MailService, PermissionCatalogService, CompanyBootstrapService, PeriodService, SequenceService, PostingService, VatService, SystemAccountsService, AccessService, NotificationsService, { provide: LocalStorage, useFactory: () => (process.env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage()) }],
  exports: [PrismaService, AuditService, MailService, CompanyBootstrapService, PeriodService, SequenceService, PostingService, VatService, SystemAccountsService, AccessService, NotificationsService, LocalStorage],
})
class CoreModule {}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const secret = cfg.get<string>('JWT_ACCESS_SECRET');
        if (!secret || secret.length < 32) throw new Error('JWT_ACCESS_SECRET must be set (min 32 characters)');
        return { secret, signOptions: { expiresIn: (cfg.get('JWT_ACCESS_TTL') ?? '15m') as any, algorithm: 'HS256' } };
      },
    }),
    CoreModule,
    AuthModule,
  ],
  controllers: [CompaniesController, UsersController, AccountingController, CoaController, LedgersController, VouchersController, ReportsController, VatController, CustomersController, SuppliersController, SalesDocumentsController, PurchaseDocumentsController, ReceiptsController, SupplierPaymentsController, RecurringController, InventoryController, CrmController, HrController, ExpensesController, ProjectsController, AssetsController, DashboardController, AttachmentsController, NotificationsController, PrintController, AuditController, JournalController],
  providers: [
    JobsService, DocumentsService, SettlementsService, RecurringService, InventoryHooks, InventoryService, InventoryReports, ModuleReports,
    VouchersService, ReportsService, ReportExportService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
