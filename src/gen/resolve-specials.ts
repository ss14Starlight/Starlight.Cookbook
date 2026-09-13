import { ResolvedEntity, SpecialDiet, SpecialReagent } from './types';

export type ResolvedSpecials = readonly Special[];

export interface Special {
  readonly mask: number;
  readonly hint: string;
  readonly color: string;
  readonly filterName: string;
  readonly filterSummary: string;
  readonly entityMatches: (ent: ResolvedEntity) => boolean;
}

// Hard limitation imposed by JS bitwise operations: we're limited to 32 bits,
// and in most cases it's *signed*. Setting this to 31 makes things less likely
// to fail for stupid reasons.
const MAX_COUNT = 31;

export const resolveSpecials = (
  allEntities: ReadonlyMap<string, ResolvedEntity>,
  diets: readonly SpecialDiet[],
  reagents: readonly SpecialReagent[]
): ResolvedSpecials => {
  const totalCount = diets.length + reagents.length;
  if (totalCount >= MAX_COUNT) {
    throw new Error(
      `Can't have more than ${
        MAX_COUNT
      } special diets and special reagents in total; got ${
        totalCount
      }`
    );
  }

  let result: Special[] = [];

  for (const diet of diets) {
    // If we get this far, then the we *know* the organ must exist.
    const { stomach } = allEntities.get(diet.organ)!;
    const digestibleTags = stomach?.tags;
    const digestibleComps = stomach?.components;
    if (!digestibleTags || !digestibleComps) {
      throw new Error(`Organ ${diet.organ} has no tags or components to filter by`);
    }
    // A non-exclusive whitelist *adds* to an ordinary diet rather than
    // replacing it, so the species can eat everything a human can. Treating
    // one as a special diet would produce a filter claiming, say, that vox eat
    // nothing but trash.
    if (!stomach.exclusive) {
      throw new Error(
        `Organ ${
          diet.organ
        } has a non-exclusive whitelist (isSpecialDigestibleExclusive: false), ` +
        `so it is not a dietary restriction and cannot be used as a special diet`
      );
    }
    const excludeReagents =
      diet.excludeFoodsWith &&
      new Set(diet.excludeFoodsWith);
    const mask = 1 << result.length;
    result.push({
      mask,
      hint: diet.hint,
      color: diet.color,
      filterName: diet.filterName,
      filterSummary: diet.filterSummary,
      entityMatches: ent =>
        (
          digestibleTags.some(t => ent.tags.has(t)) ||
          digestibleComps.some(c => ent.components.has(c))
        ) && (
          // There are no reagents to exclude, or...
          excludeReagents == null ||
          // ... all excluded reagents are absent from ent.reagents
          excludeReagents.isDisjointFrom(ent.reagents)
        ),
    });
  }

  for (const reagent of reagents) {
    const mask = 1 << result.length;
    result.push({
      mask,
      hint: reagent.hint,
      color: reagent.color,
      filterName: reagent.filterName,
      filterSummary: reagent.filterSummary,
      entityMatches: ent => ent.reagents.has(reagent.id),
    });
  }

  return result;
};
