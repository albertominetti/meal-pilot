import { Module } from '@nestjs/common';
import { AgentModule } from './agent/agent.module';
import { AppConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { LandingController } from './landing/landing.controller';
import { LlmModule } from './llm/llm.module';
import { MealPlanModule } from './meal-plan/meal-plan.module';
import { VideosModule } from './videos/videos.module';
import { YouTubeModule } from './youtube/youtube.module';

@Module({
  imports: [
    AppConfigModule,
    LlmModule,
    VideosModule,
    YouTubeModule,
    MealPlanModule,
    AgentModule,
  ],
  controllers: [LandingController, HealthController],
})
export class AppModule {}
