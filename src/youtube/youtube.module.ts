import { Module, Provider } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';
import { FakeYouTubeService } from './fake-youtube.service';
import { IYouTubeService, YOUTUBE_SERVICE } from './youtube.interface';
import { YouTubeService } from './youtube.service';

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
    YouTubeService,
    FakeYouTubeService,
    youTubeServiceProvider,
  ],
  exports: [YOUTUBE_SERVICE, YouTubeService, FakeYouTubeService],
})
export class YouTubeModule {}
