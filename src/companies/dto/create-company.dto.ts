import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateCompanyDto {
  @ApiProperty({ example: 'Acme Ltd.' })
  @IsString()
  name: string;

  @ApiProperty({ example: '123 Main St' })
  @IsString()
  address: string;
}
