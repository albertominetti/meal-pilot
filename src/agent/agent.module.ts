import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { LlmModule } from '../llm/llm.module';
import { MealPlanModule } from '../meal-plan/meal-plan.module';
import { VideosModule } from '../videos/videos.module';
import { YouTubeModule } from '../youtube/youtube.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { FallbackPlanner } from './fallback-planner';
import { AnalyzeVideoTool } from './tools/analyze-video.tool';
import { CheckProfileFitTool } from './tools/check-profile-fit.tool';
import { ListKnownVideosTool } from './tools/list-known-videos.tool';
import { SearchVideosTool } from './tools/search-videos.tool';
import { SubmitPlanTool } from './tools/submit-plan.tool';

@Module({
  imports: [
    AppConfigModule,
    LlmModule,
    VideosModule,
    YouTubeModule,
    MealPlanModule,
  ],
  controllers: [AgentController],
  providers: [
    ListKnownVideosTool,
    SearchVideosTool,
    AnalyzeVideoTool,
    CheckProfileFitTool,
    SubmitPlanTool,
    FallbackPlanner,
    AgentService,
  ],
  exports: [AgentService],
})
export class AgentModule {}
