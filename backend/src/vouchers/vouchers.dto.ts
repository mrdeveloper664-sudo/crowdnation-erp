import { Type } from 'class-transformer';
import { VoucherStatus, VoucherType } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import { IsMoney, IsoDate } from '../common/validators';

export class VoucherLineDto {
  @IsUUID() accountId: string;
  @IsOptional() @IsMoney() debit?: string;
  @IsOptional() @IsMoney() credit?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  /** VAT tagging: on a VAT ledger line, the tax code version and the net (taxable) amount it relates to. */
  @IsOptional() @IsUUID() taxRateId?: string;
  @IsOptional() @IsMoney() taxableAmount?: string;
}

export class VoucherDto {
  @IsEnum(VoucherType) type: VoucherType;
  @Matches(IsoDate) date: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) narration?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() @Matches(/^\d{1,10}(\.\d{1,8})?$/) exchangeRate?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => VoucherLineDto) lines: VoucherLineDto[];
}

export class UpdateVoucherDto {
  @IsOptional() @Matches(IsoDate) date?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) narration?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() @Matches(/^\d{1,10}(\.\d{1,8})?$/) exchangeRate?: string;
  @IsOptional() @IsArray() @ArrayMinSize(2) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => VoucherLineDto) lines?: VoucherLineDto[];
}

export class ReasonDto {
  @IsString() @Length(3, 500) reason: string;
  @IsOptional() @Matches(IsoDate) date?: string; // reversal date (defaults to today)
}

export class VoucherQuery {
  @IsOptional() @IsEnum(VoucherType) type?: VoucherType;
  @IsOptional() @IsEnum(VoucherStatus) status?: VoucherStatus;
  @IsOptional() @Matches(IsoDate) from?: string;
  @IsOptional() @Matches(IsoDate) to?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() page?: string;
  @IsOptional() pageSize?: string;
}
