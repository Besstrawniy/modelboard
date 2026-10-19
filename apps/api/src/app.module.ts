import { FilesController } from './files.controller.js';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AuthGuard } from './auth.js';

@Module({
  controllers: [AppController,FilesController],
  providers: [AuthGuard],
})
export class AppModule {}
