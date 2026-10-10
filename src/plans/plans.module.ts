import { Module } from '@nestjs/common';
import { AgentController } from '../agent/agent.controller';
import { AgentModule } from '../agent/agent.module';
import { MealPlanController } from '../meal-plan/meal-plan.controller';
import { MealPlanModule } from '../meal-plan/meal-plan.module';
import { UsersModule } from '../users/users.module';
import { VideosModule } from '../videos/videos.module';
import { YouTubeModule } from '../youtube/youtube.module';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

/**
 * Both meal-plan endpoints live here: they resolve the stored profile,
 * run a planner and save the result as a plan.
 */
@Module({
  imports: [UsersModule, MealPlanModule, AgentModule, VideosModule, YouTubeModule],
  controllers: [MealPlanController, AgentController, PlansController],
  providers: [PlansService],
})
export class PlansModule {}
