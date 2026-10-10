import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { checkPlanBalance } from '../../recipes/plan-balance';
import { AgentRun } from '../agent-run';
import { AgentTool } from './tool.interface';

const checkPlanBalanceArgsSchema = z.object({
  videoIds: z.array(z.string()).min(1).max(20).describe('Analyzed videos you intend to submit'),
});
type CheckPlanBalanceArgs = z.infer<typeof checkPlanBalanceArgsSchema>;

@Injectable()
export class CheckPlanBalanceTool implements AgentTool<CheckPlanBalanceArgs> {
  name = 'check_plan_balance';
  description =
    'Deterministic advice on a draft plan before submit_plan: main-protein and cuisine spread, repeated recipes, prep time against the limit, shared ingredients, and restrictions or goals no recipe covers. Returns warnings; it never rejects.';

  parameters: Record<string, unknown> = {
    type: 'object',
    properties: {
      videoIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Analyzed video IDs of the draft plan',
      },
    },
    required: ['videoIds'],
  };

  zodSchema = checkPlanBalanceArgsSchema;

  async execute(args: CheckPlanBalanceArgs, run: AgentRun): Promise<Record<string, unknown>> {
    const unknown = args.videoIds.filter((id) => !run.analyzedVideos.has(id));
    const analyses = [...new Set(args.videoIds)]
      .map((id) => run.analyzedVideos.get(id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a));
    const balance = checkPlanBalance(analyses, run.request);
    if (unknown.length) {
      balance.warnings.unshift(`Not analyzed yet (cannot be submitted): ${unknown.join(', ')}.`);
    }
    return { ...balance };
  }
}
