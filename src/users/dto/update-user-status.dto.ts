import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateUserStatusDto {
  @ApiProperty({
    example: true,
    description: 'Set user active (true) or inactive (false)',
  })
  @IsNotEmpty()
  @IsBoolean()
  isActive: boolean;
}
