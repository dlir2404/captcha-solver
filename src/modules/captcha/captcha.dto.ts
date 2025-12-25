import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class GetCaptchaQuery {
  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isDebug?: boolean;
}
