import { Type } from 'class-transformer';
import { DocType } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import { IsMoney, IsoDate } from '../common/validators';

export class DocLineDto {
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @Matches(/^\d{1,12}(\.\d{1,4})?$/) quantity: string;
  @IsOptional() @IsMoney() unitPrice?: string;
  @IsOptional() @Matches(/^\d{1,3}(\.\d{1,4})?$/) discountPct?: string;
  @IsOptional() @IsString() @MaxLength(20) taxCode?: string; // STD / ZERO / EXEMPT / OOS ...
  @IsOptional() @IsUUID() accountId?: string; // income / expense ledger override
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() batchNo?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) serialNos?: string[];
  @IsOptional() @IsUUID() sourceLineId?: string;
}

export class DocDto {
  @IsEnum(DocType) type: DocType;
  @IsUUID() partyId: string;
  @Matches(IsoDate) date: string;
  @IsOptional() @Matches(IsoDate) dueDate?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() @Matches(/^\d{1,10}(\.\d{1,8})?$/) exchangeRate?: string;
  @IsOptional() @IsBoolean() pricesIncludeVat?: boolean;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() sourceDocId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => DocLineDto) lines: DocLineDto[];
}

export class UpdateDocDto {
  @IsOptional() @Matches(IsoDate) date?: string;
  @IsOptional() @Matches(IsoDate) dueDate?: string;
  @IsOptional() @IsBoolean() pricesIncludeVat?: boolean;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => DocLineDto) lines?: DocLineDto[];
}

export class ConvertDto { @IsEnum(DocType) to: DocType }
export class ApplyDto { @IsUUID() invoiceId: string; @IsMoney() amount: string }
export class DocReasonDto { @IsString() @Length(3, 500) reason: string }
