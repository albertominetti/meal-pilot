import { z } from 'zod';
import { AgentRun } from '../agent-run';

export interface AgentTool<TArgs = any> {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  zodSchema: z.ZodType<TArgs>;
  execute(
    args: TArgs,
    run: AgentRun,
  ): Promise<Record<string, unknown> | Array<unknown> | string>;
}
