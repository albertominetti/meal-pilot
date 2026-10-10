import { Module, Provider } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';
import { LlmModule } from '../llm/llm.module';
import { YouTubeModule } from '../youtube/youtube.module';
import { GeminiVideoAnalyzer } from './analyzers/gemini-video-analyzer';
import { MockVideoAnalyzer } from './analyzers/mock-video-analyzer';
import {
  VIDEO_ANALYZER,
  VideoAnalyzer,
} from './analyzers/video-analyzer.interface';
import { DatabaseService } from '../db/database.service';
import { ANALYSIS_STORE, AnalysisStore } from './analysis-store';
import { FileAnalysisStore } from './file-analysis.store';
import { PgAnalysisStore } from './pg-analysis.store';
import { VideoAnalysisService } from './video-analysis.service';
import { VideosController } from './videos.controller';

const videoAnalyzerProvider: Provider = {
  provide: VIDEO_ANALYZER,
  useFactory: (
    config: AppConfigService,
    geminiAnalyzer: GeminiVideoAnalyzer,
    mockAnalyzer: MockVideoAnalyzer,
  ): VideoAnalyzer => {
    if (config.effectiveLlmMode === 'live') {
      return geminiAnalyzer;
    }
    return mockAnalyzer;
  },
  inject: [AppConfigService, GeminiVideoAnalyzer, MockVideoAnalyzer],
};

const analysisStoreProvider: Provider = {
  provide: ANALYSIS_STORE,
  useFactory: (database: DatabaseService): AnalysisStore =>
    database.enabled ? new PgAnalysisStore(database) : new FileAnalysisStore(),
  inject: [DatabaseService],
};

@Module({
  imports: [AppConfigModule, LlmModule, YouTubeModule],
  controllers: [VideosController],
  providers: [
    analysisStoreProvider,
    GeminiVideoAnalyzer,
    MockVideoAnalyzer,
    videoAnalyzerProvider,
    VideoAnalysisService,
  ],
  exports: [
    ANALYSIS_STORE,
    VideoAnalysisService,
    VIDEO_ANALYZER,
    GeminiVideoAnalyzer,
    MockVideoAnalyzer,
  ],
})
export class VideosModule {}
