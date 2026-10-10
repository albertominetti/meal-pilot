import { Module, Provider } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';
import { DatabaseService } from '../db/database.service';
import { FakeYouTubeService } from './fake-youtube.service';
import { TrustedChannelsService } from './trusted-channels.service';
import { IYouTubeService, YOUTUBE_SERVICE } from './youtube.interface';
import { YouTubeService } from './youtube.service';
import { MemorySearchCache, PgSearchCache, SEARCH_CACHE, SearchCacheStore } from './search-cache.store';

const searchCacheProvider: Provider = {
  provide: SEARCH_CACHE,
  useFactory: (database: DatabaseService): SearchCacheStore =>
    database.enabled ? new PgSearchCache(database) : new MemorySearchCache(),
  inject: [DatabaseService],
};

const youTubeServiceProvider: Provider = {
  provide: YOUTUBE_SERVICE,
  useFactory: (
    config: AppConfigService,
    liveService: YouTubeService,
    fakeService: FakeYouTubeService,
  ): IYouTubeService => {
    if (config.youtubeApiKey) {
      return liveService;
    }
    return fakeService;
  },
  inject: [AppConfigService, YouTubeService, FakeYouTubeService],
};

@Module({
  imports: [AppConfigModule],
  providers: [
    searchCacheProvider,
    YouTubeService,
    FakeYouTubeService,
    TrustedChannelsService,
    youTubeServiceProvider,
  ],
  exports: [YOUTUBE_SERVICE, YouTubeService, FakeYouTubeService, TrustedChannelsService],
})
export class YouTubeModule {}
