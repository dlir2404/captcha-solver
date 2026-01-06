import { Module } from '@nestjs/common';
import { CaptchaModule } from './modules/captcha/captcha.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [CaptchaModule, ConfigModule.forRoot({ isGlobal: true })],
})
export class AppModule {}
