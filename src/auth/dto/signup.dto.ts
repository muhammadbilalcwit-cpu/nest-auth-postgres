import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNumber, IsString, MinLength } from 'class-validator';

export class SignupDto {
  @ApiProperty({ example: 'test@gmail.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '12345678' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  firstname?: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  lastname?: string;

  @ApiProperty({ example: 30 })
  @IsNumber()
  age?: number;
}
