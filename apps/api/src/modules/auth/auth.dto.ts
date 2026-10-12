import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ minLength: 10 }) @IsString() @MinLength(10) @MaxLength(200) password: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) displayName: string;
}

export class LoginDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MaxLength(200) password: string;
}

export class TokenDto {
  @ApiProperty() @IsString() @MaxLength(200) token: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail() email: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @MaxLength(200) token: string;
  @ApiProperty({ minLength: 10 }) @IsString() @MinLength(10) @MaxLength(200) password: string;
}

export class UpdateMeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() preferences?: Record<string, unknown>;
}
