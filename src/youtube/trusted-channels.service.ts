import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { AppConfigService } from '../config/app-config.service';

const TrustedChannelSchema = z.object({
  channelId: z.string().min(1),
  name: z.string(),
  note: z.string().optional(),
});
export type TrustedChannel = z.infer<typeof TrustedChannelSchema>;

const DEFAULT_FILE = path.join(process.cwd(), 'data', 'trusted-channels.json');

/**
 * Team-reviewed YouTube channels whose recipes we prefer. Read once at
 * startup from data/trusted-channels.json (or TRUSTED_CHANNELS_FILE).
 */
@Injectable()
export class TrustedChannelsService {
  private readonly logger = new Logger(TrustedChannelsService.name);
  private readonly channels: Map<string, TrustedChannel>;

  constructor(config: AppConfigService) {
    this.channels = new Map(
      this.load(config.trustedChannelsFile || DEFAULT_FILE).map((c) => [c.channelId, c]),
    );
  }

  isTrusted(channelId: string | undefined): boolean {
    return Boolean(channelId && this.channels.has(channelId));
  }

  list(): TrustedChannel[] {
    return [...this.channels.values()];
  }

  private load(file: string): TrustedChannel[] {
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = z.array(TrustedChannelSchema).safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (!parsed.success) {
        this.logger.warn(`Ignoring invalid trusted channel file ${file}: ${parsed.error.message}`);
        return [];
      }
      return parsed.data;
    } catch (err) {
      this.logger.warn(`Could not read trusted channel file ${file}: ${err}`);
      return [];
    }
  }
}
