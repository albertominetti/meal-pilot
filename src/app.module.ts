import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AgentModule } from './agent/agent.module';
import { RequestLoggingInterceptor } from './common/request-logging.interceptor';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { LandingController } from './landing/landing.controller';
import { LlmModule } from './llm/llm.module';
import { MealPlanModule } from './meal-plan/meal-plan.module';
import { ShoppingModule } from './shopping/shopping.module';
import { VideosModule } from './videos/videos.module';
import { YouTubeModule } from './youtube/youtube.module';

@Module({
  imports: [
    AppConfigModule,
    DbModule,
    LlmModule,
    VideosModule,
    YouTubeModule,
    MealPlanModule,
    AgentModule,
    ShoppingModule,
  ],
  controllers: [LandingController, HealthController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
  ],
})
export class AppModule {}
