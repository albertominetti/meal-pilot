import { Controller, Delete, Get, Inject, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ANALYSIS_STORE, AnalysisStore } from './analysis-store';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(@Inject(ANALYSIS_STORE) private readonly cache: AnalysisStore) {}

  @Get('cache')
  async list() {
    const items = await this.cache.list();
    return { count: items.length, items };
  }

  @Delete('cache')
  clearAll() {
    return this.cache.clear();
  }

  @Delete('cache/:videoId')
  clearOne(@Param('videoId') videoId: string) {
    return this.cache.clear(videoId);
  }
}
