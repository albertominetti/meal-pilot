import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { MealPlanController } from './meal-plan/meal-plan.controller';
import { MealPlanService } from './meal-plan/meal-plan.service';
import { VideosController } from './videos/videos.controller';
import { TranscriptCacheService } from './videos/transcript-cache.service';
import { GeminiService } from './videos/gemini.service';
import { VideoAnalysisService } from './videos/video-analysis.service';

@Module({
  controllers: [HealthController, MealPlanController, VideosController],
  providers: [
    MealPlanService,
    TranscriptCacheService,
    GeminiService,
    VideoAnalysisService,
  ],
})
export class AppModule {}
