import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,128}$/;
const PASSWORD_MSG = 'Password must be 10-128 characters with upper case, lower case and a digit';

export class RegisterCompanyDto {
  @IsString() @Length(2, 120) companyName: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{3,32}$/, { message: 'Company code must be 3-32 letters, digits, - or _' }) companyCode: string;
  @IsOptional() @IsString() @Length(3, 3) baseCurrency?: string;
  @IsOptional() @IsString() @Length(2, 2) country?: string;
  @IsOptional() @IsString() @MaxLength(32) trn?: string;
  @IsString() @Length(2, 120) adminName: string;
  @IsEmail() adminEmail: string;
  @IsString() @Matches(PASSWORD_RE, { message: PASSWORD_MSG }) password: string;
}

export class LoginDto {
  @IsString() @Length(3, 32) companyCode: string;
  @IsEmail() email: string;
  @IsString() @MinLength(1) @MaxLength(128) password: string;
}

export class RefreshDto { @IsString() @MaxLength(300) refreshToken: string }
export class TokenDto { @IsString() @MaxLength(300) token: string }

export class ForgotPasswordDto {
  @IsString() @Length(3, 32) companyCode: string;
  @IsEmail() email: string;
}

export class ResetPasswordDto {
  @IsString() @MaxLength(300) token: string;
  @IsString() @Matches(PASSWORD_RE, { message: PASSWORD_MSG }) newPassword: string;
}

export class AcceptInviteDto {
  @IsString() @MaxLength(300) token: string;
  @IsString() @Length(2, 120) name: string;
  @IsString() @Matches(PASSWORD_RE, { message: PASSWORD_MSG }) password: string;
}

export class ChangePasswordDto {
  @IsString() currentPassword: string;
  @IsString() @Matches(PASSWORD_RE, { message: PASSWORD_MSG }) newPassword: string;
}
