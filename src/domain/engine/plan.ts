import { allocate } from './allocate';
import { assemblePlan } from './check';
import { buildModel } from './model';
import { findUnplanned, runPasses } from './passes';
import type { PlanInput, PlanResult } from './types';

/**
 * The scheduling engine. A pure function: the same input always gives the same output, and
 * nothing outside the input is read. No clock, no randomness, no database. See docs/engine.md.
 *
 *   1. validate   2. forward pass   3. backward pass   4. allocate   5. check   6. explain
 *
 * Returns the plan, or the reasons it refused to plan. It stops rather than guess.
 */
export function plan(input: PlanInput): PlanResult {
  const built = buildModel(input);
  if (!built.ok) return built;
  const { model } = built;

  const unplanned = findUnplanned(model);
  const passes = runPasses(model, unplanned);
  const allocation = allocate(model, passes, unplanned);
  return { ok: true, plan: assemblePlan(model, passes, allocation) };
}
