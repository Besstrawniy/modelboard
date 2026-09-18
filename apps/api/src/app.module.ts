import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AuthGuard } from './auth.js';

@Module({
  controllers: [AppController],
  providers: [AuthGuard],
})
export class AppModule {}
