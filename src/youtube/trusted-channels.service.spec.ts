import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TrustedChannelsService } from './trusted-channels.service';

function withFile(content: string): TrustedChannelsService {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-')), 'channels.json');
  fs.writeFileSync(file, content);
  return new TrustedChannelsService({ trustedChannelsFile: file } as any);
}

describe('TrustedChannelsService', () => {
  it('recognises listed channel ids', () => {
    const svc = withFile(JSON.stringify([{ channelId: 'UC1', name: 'One' }]));
    expect(svc.isTrusted('UC1')).toBe(true);
    expect(svc.isTrusted('UC2')).toBe(false);
    expect(svc.isTrusted(undefined)).toBe(false);
  });

  it('ignores an invalid file instead of failing startup', () => {
    expect(withFile('{"not": "a list"}').list()).toEqual([]);
    expect(withFile('not json').list()).toEqual([]);
  });

  it('ships an empty, valid default list', () => {
    const svc = new TrustedChannelsService({ trustedChannelsFile: '' } as any);
    expect(svc.list()).toEqual([]);
  });
});
