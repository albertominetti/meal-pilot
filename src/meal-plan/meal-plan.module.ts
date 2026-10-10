import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { VideosModule } from '../videos/videos.module';
import { YouTubeModule } from '../youtube/youtube.module';
import { MealPlanController } from './meal-plan.controller';
import { MealPlanService } from './meal-plan.service';

@Module({
  imports: [AppConfigModule, VideosModule, YouTubeModule],
  controllers: [MealPlanController],
  providers: [MealPlanService],
  exports: [MealPlanService],
})
export class MealPlanModule {}
