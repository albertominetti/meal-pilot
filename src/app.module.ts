import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgentController } from './agent/agent.controller';
import { AgentService } from './agent/agent.service';
import { AppConfig, validateEnv } from './config/app-config.service';
import { HealthController } from './health/health.controller';
import { LandingController } from './landing/landing.controller';
import { LlmModule } from './llm/llm.module';
import { MealPlanController } from './meal-plan/meal-plan.controller';
import { MealPlanService } from './meal-plan/meal-plan.service';
import { GeminiVideoAnalyzer } from './videos/analyzers/gemini-video-analyzer';
import { MockVideoAnalyzer } from './videos/analyzers/mock-video-analyzer';
import { TranscriptCacheService } from './videos/transcript-cache.service';
import { VideoAnalysisService } from './videos/video-analysis.service';
import { VideosController } from './videos/videos.controller';
import { YouTubeClient, YouTubeService } from './youtube/youtube.service';

@Global()
@Module({
  providers: [AppConfig],
  exports: [AppConfig],
})
class AppConfigModule {}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      // Tests must never pick up a developer's real key from .env.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnv,
    }),
    // Default: 60 req/min per IP; the agent endpoint is stricter (see AgentController).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    AppConfigModule,
    LlmModule,
  ],
  controllers: [LandingController, HealthController, MealPlanController, AgentController, VideosController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: YouTubeClient, useClass: YouTubeService },
    MealPlanService,
    TranscriptCacheService,
    GeminiVideoAnalyzer,
    MockVideoAnalyzer,
    VideoAnalysisService,
    AgentService,
  ],
})
export class AppModule {}
