import 'reflect-metadata';
import { json } from 'express';
import { NestFactory } from '@nestjs/core';
import { runMigrations } from '@modelboard/db';
import { AppModule } from './app.module.js';

async function bootstrap() {
  await runMigrations();

  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  app.use(json({ limit: '40mb' }));
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: false,
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.log(`ModelBoard API listening on http://localhost:${port}/api`);
}

bootstrap();
