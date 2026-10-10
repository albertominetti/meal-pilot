import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentMealPlanResponse, AgentService } from '../agent/agent.service';
import { MealPlanRequestDto } from '../meal-plan/dto/meal-plan-request.dto';
import { MealPlanResponseDto, RecommendationDto } from '../meal-plan/dto/meal-plan-response.dto';
import { MealPlanService } from '../meal-plan/meal-plan.service';
import { checkTime, matchGoals } from '../meal-plan/profile-fit';
import { buildRecommendation } from '../meal-plan/recommendation.builder';
import { nutritionNote } from '../nutrition/nutrition-note';
import { checkPlanBalance, MAX_SAME_PROTEIN } from '../recipes/plan-balance';
import { scoreRecipe } from '../recipes/ranking';
import { recipeTags, restrictionCoverage } from '../recipes/restrictions';
import { buildShoppingList, ShoppingList } from '../shopping/shopping-list';
import { FeedbackMap, isExcludedByRating } from '../users/feedback';
import { mergeAllergies, ProfilesService } from '../users/profiles.service';
import { ANONYMOUS_PLAN_TTL_MS, StoredPlan, USER_DATA_STORE, UserDataStore } from '../users/user-data.store';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { ANALYSIS_STORE, AnalysisStore } from '../videos/analysis-store';
import { TrustedChannelsService } from '../youtube/trusted-channels.service';

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** The swap fallback is a short single-slot agent run. */
const SWAP_AGENT_BUDGETS = { maxSearches: 1, maxAnalyses: 2, maxSteps: 6 };

export interface PlanView {
  planId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  recommendations: RecommendationDto[];
  shoppingList: ShoppingList;
  checked: string[];
}

export interface SwapResult extends PlanView {
  swapped: { removed: string; added: string; via: 'cache' | 'agent' };
}

/** Enough of an analysis, rebuilt from a stored recommendation, for balance checks and shopping lists. */
function analysisFromItem(item: RecommendationDto): VideoAnalysis {
  const r = item.recipe;
  return {
    videoId: item.videoId,
    title: item.title,
    channel: item.channel,
    recipeName: r.recipeName,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    mainProtein: r.mainProtein,
    cuisine: r.cuisine,
    mealType: r.mealType,
    coverage: r.coverage,
    ingredients: r.ingredients,
    steps: r.steps,
    labelCheck: r.labelCheck,
    nutrition: r.nutrients,
    restrictionTags: [],
    nutritionSignals: [],
  } as unknown as VideoAnalysis;
}

function itemKeys(list: ShoppingList): Set<string> {
  return new Set([...list.sections.flatMap((s) => s.items), ...list.pantry].map((i) => i.key));
}

/**
 * Saved plans: every meal-plan response is stored and gets a planId, so the
 * app can keep checkbox state and swap one meal. Plans built for a user
 * belong to them and are erased with their profile.
 */
@Injectable()
export class PlansService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlansService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(USER_DATA_STORE) private readonly store: UserDataStore,
    @Inject(ANALYSIS_STORE) private readonly analyses: AnalysisStore,
    private readonly profiles: ProfilesService,
    private readonly mealPlan: MealPlanService,
    private readonly agent: AgentService,
    private readonly trustedChannels: TrustedChannelsService,
  ) {}

  onModuleInit(): void {
    void this.cleanup();
    this.timer = setInterval(() => void this.cleanup(), CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async cleanup(): Promise<number> {
    try {
      return await this.store.deleteAnonymousPlansBefore(new Date(Date.now() - ANONYMOUS_PLAN_TTL_MS));
    } catch (err) {
      this.logger.warn(`Plan cleanup failed: ${(err as Error).message}`);
      return 0;
    }
  }

  async createDeterministic(dto: MealPlanRequestDto): Promise<MealPlanResponseDto> {
    const { request, feedback } = await this.profiles.resolve(dto);
    const response = await this.mealPlan.buildPlan(request, { feedback });
    return { ...response, ...(await this.save(request, response.recommendations, response.shoppingList)) };
  }

  async createWithAgent(dto: MealPlanRequestDto, debug: boolean): Promise<AgentMealPlanResponse> {
    const { request, feedback } = await this.profiles.resolve(dto);
    const response = await this.agent.run(request, debug, { feedback });
    return { ...response, ...(await this.save(request, response.recommendations, response.shoppingList)) };
  }

  /** A storage outage costs the planId, not the plan the user asked for. */
  private async save(
    request: MealPlanRequestDto,
    items: RecommendationDto[],
    shoppingList: ShoppingList,
  ): Promise<{ planId?: string; planVersion?: number }> {
    const now = new Date().toISOString();
    const plan: StoredPlan = {
      id: randomUUID(),
      userId: request.userId ?? null,
      version: 1,
      request,
      items,
      shoppingList,
      checked: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.store.createPlan(plan);
      return { planId: plan.id, planVersion: plan.version };
    } catch (err) {
      this.logger.warn(`Could not save plan: ${(err as Error).message}`);
      return {};
    }
  }

  async get(id: string): Promise<PlanView> {
    return this.view(await this.load(id));
  }

  async setChecked(id: string, checked: string[]): Promise<PlanView> {
    const plan = await this.load(id);
    const keys = itemKeys(plan.shoppingList);
    const next: StoredPlan = {
      ...plan,
      version: plan.version + 1,
      checked: [...new Set(checked.filter((k) => keys.has(k)))],
      updatedAt: new Date().toISOString(),
    };
    await this.write(next);
    return this.view(next);
  }

  /**
   * Replaces one recipe. Cheap path first: the best-ranked safe recipe from
   * the shared cache that fits the profile, isn't in the plan and keeps the
   * plan balanced, with no Gemini call. Otherwise a short single-slot agent
   * run. The shopping list is rebuilt and ticked items still in it stay ticked.
   */
  async swap(id: string, videoId: string): Promise<SwapResult> {
    const plan = await this.load(id);
    const index = plan.items.findIndex((i) => i.videoId === videoId);
    if (index === -1) throw new BadRequestException(`Video ${videoId} is not in this plan`);

    const request = await this.currentRequest(plan);
    const feedback = plan.userId ? await this.profiles.feedback(plan.userId) : new Map();
    const inPlan = plan.items.map((i) => i.videoId);
    const kept = plan.items.filter((_, i) => i !== index).map(analysisFromItem);

    let via: 'cache' | 'agent' = 'cache';
    let replacement = await this.fromCache(request, feedback, inPlan, kept, plan.items[index]);
    if (!replacement) {
      via = 'agent';
      const res = await this.agent.run({ ...request, minResults: 1, maxResults: 1 }, false, {
        feedback,
        excludeVideoIds: inPlan,
        budgets: SWAP_AGENT_BUDGETS,
      });
      replacement = res.recommendations[0] ?? null;
    }
    if (!replacement) throw new ConflictException('No safe replacement found for this recipe');

    const items = plan.items.map((item, i) => (i === index ? replacement! : item));
    const shoppingList = buildShoppingList(
      items.map((i) => ({ analysis: analysisFromItem(i) })),
      request.householdSize ?? 1,
    );
    const keys = itemKeys(shoppingList);
    const next: StoredPlan = {
      ...plan,
      version: plan.version + 1,
      items,
      shoppingList,
      checked: plan.checked.filter((k) => keys.has(k)),
      updatedAt: new Date().toISOString(),
    };
    await this.write(next);
    return { ...this.view(next), swapped: { removed: videoId, added: replacement.videoId, via } };
  }

  private async fromCache(
    request: MealPlanRequestDto,
    feedback: FeedbackMap,
    inPlan: string[],
    kept: VideoAnalysis[],
    removed: RecommendationDto,
  ): Promise<RecommendationDto | null> {
    const exclude = new Set(inPlan);
    const allergies = request.allergies ?? [];
    const isTrusted = (channelId: string | undefined) => this.trustedChannels.isTrusted(channelId);
    const ctx = { restrictions: request.restrictions, healthGoals: request.healthGoals, maxCookMinutes: request.maxCookMinutes, isTrusted, feedback };

    const seen = new Set<string>();
    const candidates: Array<{ analysis: VideoAnalysis; verdict: { status: 'safe' | 'uncertain' | 'unsafe'; notes: string }; score: number }> = [];
    for (const a of await this.analyses.list()) {
      if (a.status !== 'ok' || exclude.has(a.videoId) || seen.has(a.videoId)) continue;
      seen.add(a.videoId);
      if (isExcludedByRating(feedback, a.videoId)) continue;
      if (checkTime(a, request.maxCookMinutes).fitsTime === false) continue;
      if (restrictionCoverage(a, request.restrictions).missing.length) continue;
      const verdict = this.mealPlan.evaluateAllergySafety(a, allergies);
      if (verdict.status !== 'safe') continue;
      candidates.push({ analysis: a, verdict, score: scoreRecipe(a, ctx, kept).score });
    }
    candidates.sort((x, y) => y.score - x.score);

    for (const c of candidates) {
      const balance = checkPlanBalance([...kept, c.analysis], request);
      const tooMany = Object.entries(balance.proteins).some(
        ([p, n]) => !['none', 'other', 'unknown'].includes(p) && n > MAX_SAME_PROTEIN,
      );
      if (tooMany || balance.overTimeLimit.length) continue;

      const goals = matchGoals(c.analysis, request.healthGoals);
      return buildRecommendation({
        analysis: c.analysis,
        verdict: c.verdict,
        whyItFits: `Swapped in for "${removed.title}": ${c.analysis.summary}`,
        matchedTags: [...new Set([...recipeTags(c.analysis), ...goals.matched])],
        healthNotes: nutritionNote(c.analysis),
        request,
        trusted: isTrusted(c.analysis.channelId),
      });
    }
    return null;
  }

  /** Safety first: allergies added to the profile since the plan was made also apply. */
  private async currentRequest(plan: StoredPlan): Promise<MealPlanRequestDto> {
    if (!plan.userId) return plan.request;
    try {
      const { profile } = await this.profiles.get(plan.userId);
      return { ...plan.request, allergies: mergeAllergies(plan.request.allergies, profile.allergies) };
    } catch {
      return plan.request;
    }
  }

  private async load(id: string): Promise<StoredPlan> {
    const plan = await this.store.getPlan(id);
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  private async write(plan: StoredPlan): Promise<void> {
    if (!(await this.store.updatePlan(plan))) {
      throw new ConflictException('The plan changed meanwhile; reload it and try again');
    }
  }

  private view(plan: StoredPlan): PlanView {
    return {
      planId: plan.id,
      version: plan.version,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      recommendations: plan.items,
      shoppingList: plan.shoppingList,
      checked: plan.checked,
    };
  }
}
