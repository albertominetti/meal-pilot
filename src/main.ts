import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as path from 'path';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useStaticAssets(path.join(__dirname, '..', 'public'), {
    prefix: '/app/',
  });

  app.setGlobalPrefix('api', {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      { path: '/app', method: RequestMethod.GET },
      { path: '/app/(.*)', method: RequestMethod.GET },
    ],
  });
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('MealPilot API')
    .setDescription(
      'Match YouTube meal videos to a health profile (restrictions, allergies, blood pressure) using Gemini + transcript analysis. Informational only, not medical advice.',
    )
    .setVersion('0.2.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const appConfig = app.get(AppConfigService);
  const port = appConfig.port;
  await app.listen(port);
  console.log(`MealPilot listening on http://localhost:${port}/api (mode: ${appConfig.effectiveLlmMode})`);
}
bootstrap().catch((err) => console.error(err));
