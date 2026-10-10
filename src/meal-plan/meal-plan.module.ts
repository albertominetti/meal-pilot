import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { VideosModule } from '../videos/videos.module';
import { YouTubeModule } from '../youtube/youtube.module';
import { MealPlanService } from './meal-plan.service';

@Module({
  imports: [AppConfigModule, VideosModule, YouTubeModule],
  providers: [MealPlanService],
  exports: [MealPlanService],
})
export class MealPlanModule {}
