import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','), credentials: true });
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('NEXERP API').setVersion('0.1').addBearerAuth().build());
  SwaggerModule.setup('api/docs', app, doc);
  await app.listen(Number(process.env.PORT ?? 4000));
}
bootstrap();
