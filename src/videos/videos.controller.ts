import { Controller, Delete, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TranscriptCacheService } from './transcript-cache.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly cache: TranscriptCacheService) {}

  @Get('cache')
  list() {
    const items = this.cache.list();
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
