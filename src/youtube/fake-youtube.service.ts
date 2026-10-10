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
    // Seed with common test videos
    this.addVideo({
      videoId: 'veg-low-sodium-01',
      title: 'Low-Sodium Vegetarian Lentil Soup',
      channel: 'Healthy Kitchen',
      channelId: 'UC_healthy_kitchen',
      description:
        'Serves 4. Ingredients: 200g brown lentils, 2 carrots, 1 onion, 2 cloves garlic, 1 l low-sodium vegetable stock, 1 tbsp olive oil.',
      durationSec: 620,
      privacyStatus: 'public',
      embeddable: true,
    });
    this.addVideo({
      videoId: 'vegan-quinoa-02',
      title: 'Vegan Quinoa Buddha Bowl (Gluten-Free)',
      channel: 'Plant Table',
      channelId: 'UC_plant_table',
      description:
        'Serves 2. 150g quinoa, 1 can (400g) chickpeas, 1 avocado, 2 tbsp tahini, 1 lemon.',
      durationSec: 540,
      privacyStatus: 'public',
      embeddable: true,
    });
    this.addVideo({
      videoId: 'quick-chicken-03',
      title: 'Quick 15-Minute Chicken and Veggie Stir Fry',
      channel: 'Weeknight Cooks',
      channelId: 'UC_weeknight_cooks',
      description: 'Dinner in 15 minutes. Full recipe on our blog.',
      durationSec: 900,
      privacyStatus: 'public',
      embeddable: true,
    });
    this.addVideo({
      videoId: 'peanut-satay-04',
      title: 'Peanut Satay Noodles',
      channel: 'Wok House',
      channelId: 'UC_wok_house',
      description: '200g rice noodles, 3 tbsp peanut butter, 1 tbsp soy sauce.',
      durationSec: 480,
      privacyStatus: 'public',
      embeddable: true,
    });
    this.addVideo({
      videoId: 'tofu-curry-05',
      title: 'Easy Vegetarian Tofu Curry',
      channel: 'Spice Route',
      channelId: 'UC_spice_route',
      description:
        'Serves 3. Ingredients: 400g firm tofu, 2 tbsp red curry paste, 400ml coconut milk, 2 tbsp peanut sauce, 1 red pepper.',
      durationSec: 700,
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
