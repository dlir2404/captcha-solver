import { Injectable, Logger } from '@nestjs/common';
import { CaptchaGateway } from './captcha.gateway';

@Injectable()
export class CaptchaService {
  constructor(private readonly captchaGateway: CaptchaGateway) {}
  private logger = new Logger(CaptchaService.name);
  async getCaptcha(isDebug: boolean = false): Promise<string> {
    try {
      const token = await this.captchaGateway.requestCaptcha();
      return token;
    } catch (error) {
      this.logger.error('Failed to get captcha:', error);
      throw error;
    }
  }
}
