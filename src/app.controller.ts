import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { UpdateEnvDto } from './app.dto';
import { type RedisClientType } from 'redis';
import { CAPTCHA_VEO3_COOKIES_KEY, PROJECT_ID_KEY } from './common/const';
import { BaseResponse } from './common/dto/base.response';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { CaptchaService } from './modules/captcha/captcha.service';

@Controller()
@ApiTags('App')
export class AppController {
  constructor(
    @Inject('REDIS') private redis: RedisClientType,
    private readonly captchaService: CaptchaService,
  ) {}
  @Post('update-env')
  @ApiResponse({
    status: 200,
    description: 'Environment variables updated successfully',
    type: BaseResponse,
  })
  async updateEnv(
    @Body() updateEnvDto: UpdateEnvDto,
  ): Promise<BaseResponse<void>> {
    await this.redis.set(PROJECT_ID_KEY, updateEnvDto.projectId);
    await this.redis.set(
      CAPTCHA_VEO3_COOKIES_KEY,
      updateEnvDto.sessionInBase64,
    );

    await this.captchaService.reloadCookies();

    return new BaseResponse({ success: true });
  }

  @Get('env')
  @ApiResponse({
    status: 200,
    description: 'Retrieve current environment variables',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
            session: { type: 'object', nullable: true },
          },
        },
      },
    },
  })
  async getEnv(): Promise<{ projectId: string; session: any }> {
    const projectId = (await this.redis.get(PROJECT_ID_KEY)) || '';
    const sessionInBase64 =
      (await this.redis.get(CAPTCHA_VEO3_COOKIES_KEY)) || '';

    const session = JSON.parse(atob(sessionInBase64 || '""') || 'null');

    return { projectId, session };
  }
}
