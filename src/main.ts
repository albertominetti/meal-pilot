import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api', {
    exclude: [{ path: '/', method: RequestMethod.GET }],
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
      'Match YouTube meal videos to a health profile (restrictions, allergies, blood pressure). Gemini watches the videos and, on /meal-plan/agent, searches and selects them via function calling. Profile text is sent to Google Gemini (not stored: store=false). Informational only, not medical advice.',
    )
    .setVersion('0.2.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  console.log(`MealPilot listening on http://localhost:${port}/api`);
}
bootstrap().catch((err) => console.error(err));
