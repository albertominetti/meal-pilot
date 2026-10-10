import { Injectable } from '@nestjs/common';
import {
  IYouTubeService,
  YouTubeSearchOptions,
  YouTubeVideoDetails,
} from './youtube.interface';

@Injectable()
export class FakeYouTubeService implements IYouTubeService {
  private cannedDetails = new Map<string, YouTubeVideoDetails>();
  private cannedSearches = new Map<string, string[]>();

  constructor() {
    // Real public videos so watch URLs resolve. Channel IDs and descriptions
    // are offline fixtures (not the real ones) so the mock analyzer can
    // exercise the description path.
    this.addVideo({
      videoId: 'jfKL8pQjBCA',
      title: 'Amazing Red Lentil Soup (Low-Sodium, Vegetarian)',
      channel: 'Downshiftology',
      channelId: 'UC_fixture_downshiftology',
      description:
        'Serves 4. Ingredients: 200g red lentils, 2 carrots, 1 onion, 2 cloves garlic, 1 l low-sodium vegetable stock, 1 tbsp olive oil.',
      durationSec: 620,
      privacyStatus: 'public',
      embeddable: true,
    });
    this.addVideo({
      videoId: 'mPaJFxzwi-U',
      title: 'Healthy Quinoa Chickpea Bowl (Vegan, Gluten-Free)',
      channel: 'Food Impromptu',
      channelId: 'UC_fixture_food_impromptu',
      description:
        'Serves 2. 150g quinoa, 1 can (400g) chickpeas, 1 avocado, 2 tbsp tahini, 1 lemon.',
      durationSec: 540,
      privacyStatus: 'public',
      embeddable: true,
    });
    this.addVideo({
      videoId: 'tv6Wrr2-hRU',
      title: '15 Minute Chicken Stir-Fry',
      channel: 'The Domestic Geek',
      channelId: 'UC_fixture_domestic_geek',
      description: 'Dinner in 15 minutes. Full recipe on our blog.',
      durationSec: 900,
      privacyStatus: 'public',
      embeddable: true,
    });
    this.addVideo({
      videoId: 'ZtK81MzVoJ4',
      title: 'Easy Thai Peanut Satay Sauce',
      channel: 'Thai Girl in the Kitchen',
      channelId: 'UC_fixture_thai_girl',
      description: '3 tbsp peanut butter, 1 tbsp soy sauce, 200ml coconut milk.',
      durationSec: 480,
      privacyStatus: 'public',
      embeddable: true,
    });
  }

  addVideo(video: YouTubeVideoDetails): void {
    this.cannedDetails.set(video.videoId, video);
  }

  addSearchResult(query: string, ids: string[]): void {
    this.cannedSearches.set(query.toLowerCase(), ids);
  }

  getQuotaUsage(): { unitsUsedToday: number; dailyCap: number } {
    return { unitsUsedToday: 0, dailyCap: 9000 };
  }

  async search(query: string, opts?: YouTubeSearchOptions): Promise<string[]> {
    const norm = query.toLowerCase();
    for (const [q, ids] of this.cannedSearches) {
      if (norm.includes(q) || q.includes(norm)) {
        return ids.slice(0, opts?.maxResults ?? 10);
      }
    }

    // Default: return all canned videos matching keyword, or all canned videos
    const matches: string[] = [];
    for (const [id, details] of this.cannedDetails) {
      if (
        norm.split(/\s+/).some((w) => details.title.toLowerCase().includes(w))
      ) {
        matches.push(id);
      }
    }

    if (matches.length > 0) {
      return matches.slice(0, opts?.maxResults ?? 10);
    }

    return Array.from(this.cannedDetails.keys()).slice(
      0,
      opts?.maxResults ?? 10,
    );
  }

  async getDetails(ids: string[]): Promise<YouTubeVideoDetails[]> {
    const out: YouTubeVideoDetails[] = [];
    for (const id of ids) {
      const found = this.cannedDetails.get(id);
      if (found) {
        out.push(found);
      } else {
        out.push({
          videoId: id,
          title: `YouTube video ${id}`,
          channel: 'Healthy Channel',
          channelId: '',
          description: '',
          durationSec: 600,
          privacyStatus: 'public',
          embeddable: true,
        });
      }
    }
    return out;
  }
}
