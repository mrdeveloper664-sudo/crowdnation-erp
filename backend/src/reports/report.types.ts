export interface Column { key: string; label: string; align?: 'left' | 'right'; type?: 'text' | 'money' | 'date' | 'number' }
export interface ReportRow { [key: string]: any; _kind?: 'header' | 'total' | 'subtotal' | 'row'; _drill?: { type: 'ledger' | 'entry' | 'voucher'; id: string } }
export interface ReportResult {
  name: string; title: string; subtitle?: string; columns: Column[]; rows: ReportRow[];
  summary?: Array<{ label: string; value: string }>; meta?: Record<string, any>;
  paging?: { page: number; pageSize: number; total: number; totalPages: number };
}
export interface ReportQuery {
  from?: string; to?: string; asOf?: string; financialYearId?: string; branchId?: string; accountId?: string; search?: string;
  page?: string; pageSize?: string; voucherType?: string; hideZero?: string; format?: string;
}
