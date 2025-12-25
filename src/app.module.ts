import { Module } from '@nestjs/common';
import { CaptchaModule } from './modules/captcha/captcha.module';
import { RedisModule } from './modules/redis/redis.module';
import { AppController } from './app.controller';

@Module({
  imports: [CaptchaModule, RedisModule],
  controllers: [AppController],
})
export class AppModule {}
