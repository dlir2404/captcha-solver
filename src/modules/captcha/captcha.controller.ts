import { Controller, Get, Post, Query } from '@nestjs/common';
import { CaptchaService } from './captcha.service';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetCaptchaQuery } from './captcha.dto';

@Controller('captcha')
@ApiTags('Captcha')
export class CaptchaController {
  constructor(private readonly captchaService: CaptchaService) {}

  @Get('')
  @ApiResponse({
    status: 200,
    description: 'Get captcha solution',
    schema: {
      type: 'object',
      properties: {
        captcha: { type: 'string' },
      },
    },
  })
  async getCaptcha(
    @Query() query: GetCaptchaQuery,
  ): Promise<{ captcha: string }> {
    const captcha = await this.captchaService.getCaptcha(query.isDebug);
    return { captcha };
  }
}
