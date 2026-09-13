import {
  OneOrMoreEntities,
  ReagentSourceMethod,
  VendingStock,
} from '../types';
import { EntitySpawnEntry, Solution } from './components';
import {
  DefaultDeepFryCookTime,
  DefaultRecipeGroup,
  MixerCategoryToStepType,
} from './constants';
import { ConstructRecipeBuilder } from './construct-recipe-builder';
import {
  ConstructionGraphMap,
  DeepFryingRecipe,
  EntityId,
  FoodSequenceElementId,
  FoodSequenceElementMap,
  FoodSequenceElementPrototype,
  MetamorphRecipeMap,
  MicrowaveMealRecipe,
  MicrowaveMealRecipeId,
  ReactionId,
  ReactionPrototype,
  ReagentId,
  ReagentMap,
  ReagentPrototype,
  StackId,
  StackMap,
  TagId,
  VendingMachineInventoryMap,
} from './prototypes';
import { getReagentResult, getSolidResult } from './reaction-helpers';
import { RawGameData } from './read-raw';
import { findSolution } from './solution-helpers';
import {
  ResolvedConstruction,
  ResolvedConstructionRecipe,
  ResolvedEntity,
  ResolvedEntitySource,
  ResolvedEntityMap,
  ResolvedReagentSource,
  ResolvedSpecialRecipe,
} from './types';

export interface PrunedGameData {
  readonly entities: ResolvedEntityMap;
  readonly reagents: ReagentMap;
  readonly recipes: readonly MicrowaveMealRecipe[];
  readonly reactions: readonly ReactionPrototype[];
  readonly specialRecipes: ReadonlyMap<string, ResolvedSpecialRecipe>;
  readonly reagentSources: ReadonlyMap<ReagentId, readonly ResolvedReagentSource[]>;
  readonly entitySources: ReadonlyMap<EntityId, readonly ResolvedEntitySource[]>;
  readonly foodSequenceStartPoints: ReadonlyMap<TagId, readonly EntityId[]>;
  readonly foodSequenceElements: ReadonlyMap<TagId, readonly EntityId[]>;
  readonly foodSequenceEndPoints: ReadonlyMap<TagId, readonly EntityId[]>;
}

export interface FilterParams {
  ignoredRecipes: ReadonlySet<MicrowaveMealRecipeId>;
  ignoredSpecialRecipes: ReadonlySet<string>;
  ignoredFoodSequenceElements: ReadonlySet<EntityId>;
  ignoreSourcesOf: ReadonlySet<ReagentId>;
  forceIncludeReagentSources: ReadonlyMap<ReagentId, readonly EntityId[]>;
}

export const filterRelevantPrototypes = (
  raw: Omit<RawGameData, 'entities'>,
  allEntities: ResolvedEntityMap,
  params: FilterParams
): PrunedGameData => {
  const usedEntities = new Set<EntityId>();
  const usedReagents = new Set<ReagentId>();
  const specialRecipes = new Map<string, ResolvedSpecialRecipe>();

  // First, collect microwave recipes. These are part of the "root set":
  // from these, we get an initial set of entities and reagents that are
  // relevant to the cookbook.
  const recipes = collectMicrowaveRecipes(
    raw.recipes,
    usedEntities,
    usedReagents,
    raw.stacks,
    params.ignoredRecipes
  );

  // Starlight's deep fryer recipes are prototypes too, so they also belong to
  // the root set. Their ingredients are frequently *only* reachable this way:
  // nothing else calls for a rope of dough or a frozen sundae.
  collectDeepFryingRecipes(
    raw.deepFryingRecipes,
    specialRecipes,
    usedEntities,
    allEntities,
    params.ignoredSpecialRecipes
  );

  // Next, we'll add metamorph recipes. These are the second part of the
  // root set of relevant entities and reagents.
  addMetamorphRecipes(
    raw.metamorphRecipes,
    specialRecipes,
    usedEntities,
    usedReagents,
    allEntities,
    raw.foodSequenceElements
  );

  const reactions = new Map<ReactionId, ReactionPrototype>();

  // And now we have to go through *every* entity to find special recipes:
  // cutting, rolling, heating, construction, and more.
  let hasAnythingNew: boolean;
  do {
    hasAnythingNew = false;
    for (const entity of allEntities.values()) {
      if (entity.abstract) {
        continue;
      }

      if (tryAddSpecialRecipes(
        entity,
        specialRecipes,
        usedEntities,
        usedReagents,
        allEntities,
        raw.constructionGraphs,
        raw.reagents,
        params.ignoredSpecialRecipes
      )) {
        hasAnythingNew = true;
      }
    }
  } while (hasAnythingNew);

  // Now let's find reactions for all the reagents we've collected.
  do {
    hasAnythingNew = false;
    for (const reaction of raw.reactions) {
      if (tryAddReaction(
        reactions,
        reaction,
        usedEntities,
        usedReagents,
        raw.reagents
      )) {
        hasAnythingNew = true;
      }
    }
  } while (hasAnythingNew);

  // And now we collect *sources* of reagents.
  const reagentSources = collectReagentSources(
    allEntities,
    usedEntities,
    usedReagents,
    params.ignoreSourcesOf,
    params.forceIncludeReagentSources
  );

  // Vending stock is another way to obtain ingredients that have no recipe.
  // Keep it as source metadata rather than inventing fake cooking recipes.
  const entitySources = collectVendingSources(
    raw.vendingMachineInventories,
    allEntities,
    usedEntities
  );

  // We know the total set of relevant entities now, so we'll use that
  // to collect food sequence information, i.e. what can be put inside
  // which food sequence start point.
  const foodSequences = collectFoodSequences(
    usedEntities,
    allEntities,
    params.ignoredFoodSequenceElements
  );

  // Lastly, we'll resolve the entity and reagent IDs to actual entities
  // and reagents, respectively.
  const entities = new Map<EntityId, ResolvedEntity>();
  for (const id of usedEntities) {
    const entity = allEntities.get(id);
    if (!entity) {
      throw new Error(`Could not resolve entity: ${id}`);
    }
    entities.set(id, entity);
  }

  const reagents = new Map<ReagentId, ReagentPrototype>();
  for (const id of usedReagents) {
    const reagent = raw.reagents.get(id);
    if (!reagent) {
      throw new Error(`Could not resolve reagent: ${id}`);
    }
    reagents.set(id, reagent);
  }

  return {
    entities,
    reagents,
    recipes,
    reactions: Array.from(reactions.values()),
    specialRecipes,
    reagentSources,
    entitySources,
    foodSequenceStartPoints: foodSequences.startPoints,
    foodSequenceElements: foodSequences.elements,
    foodSequenceEndPoints: foodSequences.endPoints,
  };
};

const collectVendingSources = (
  inventories: VendingMachineInventoryMap,
  allEntities: ResolvedEntityMap,
  usedEntities: Set<EntityId>
): Map<EntityId, ResolvedEntitySource[]> => {
  const result = new Map<EntityId, ResolvedEntitySource[]>();
  const relevantItems = new Set(usedEntities);
  const sourceVendors = new Set<EntityId>();

  const addStock = (
    vendor: EntityId,
    stock: VendingStock,
    entries: Readonly<Record<EntityId, number>> | undefined
  ): void => {
    for (const item of Object.keys(entries ?? {}) as EntityId[]) {
      if (!relevantItems.has(item)) {
        continue;
      }

      let sources = result.get(item);
      if (!sources) {
        sources = [];
        result.set(item, sources);
      }
      if (!sources.some(s => s.vendor === vendor && s.stock === stock)) {
        sources.push({ type: 'vending', vendor, stock });
      }
      sourceVendors.add(vendor);
    }
  };

  for (const vendor of allEntities.values()) {
    if (
      vendor.abstract ||
      vendor.components.has('EmptyVendingMachine') ||
      !vendor.vendingMachineInventory
    ) {
      continue;
    }
    const inventory = inventories.get(vendor.vendingMachineInventory);
    if (!inventory) {
      continue;
    }

    addStock(vendor.id, 'starting', inventory.startingInventory);
    addStock(vendor.id, 'contraband', inventory.contrabandInventory);
    addStock(vendor.id, 'emagged', inventory.emaggedInventory);
  }

  for (const vendor of sourceVendors) {
    usedEntities.add(vendor);
  }
  return result;
};

const collectMicrowaveRecipes = (
  allRecipes: readonly MicrowaveMealRecipe[],
  usedEntities: Set<EntityId>,
  usedReagents: Set<ReagentId>,
  stacks: StackMap,
  ignoredRecipes: ReadonlySet<string>
): MicrowaveMealRecipe[] => {
  const relevantRecipes = allRecipes.filter(r => !ignoredRecipes.has(r.id));
  for (const recipe of relevantRecipes) {
    if (ignoredRecipes.has(recipe.id)) {
      continue;
    }
    usedEntities.add(recipe.result);

    if (recipe.solids) {
      for (const id of Object.keys(recipe.solids)) {
        const stack = stacks.get(id as StackId);
        if (stack) {
          usedEntities.add(stack.spawn);
        } else {
          usedEntities.add(id as EntityId);
        }
      }
    }

    if (recipe.reagents) {
      for (const id of Object.keys(recipe.reagents)) {
        usedReagents.add(id as ReagentId);
      }
    }
  }
  return relevantRecipes;
};

const collectDeepFryingRecipes = (
  allRecipes: readonly DeepFryingRecipe[],
  specialRecipes: Map<string, ResolvedSpecialRecipe>,
  usedEntities: Set<EntityId>,
  allEntities: ResolvedEntityMap,
  ignoredSpecialRecipes: ReadonlySet<string>
): void => {
  for (const recipe of allRecipes) {
    // Keyed on the ingredient, like Frontier's deep fry recipes, since that's
    // what the fryer matches on. Two prototypes with the same ingredient could
    // never both fire in game -- the fryer takes the first one it enumerates --
    // so first one wins here too.
    const recipeId = `deepFry!${recipe.ingredient}`;
    if (specialRecipes.has(recipeId) || ignoredSpecialRecipes.has(recipeId)) {
      continue;
    }

    // Deep fryer recipes reference entities by ID with no validation on the
    // game's side: a typo, or content that didn't come along with the port,
    // just means the recipe never fires. Don't let it take the build down.
    const ingredient = allEntities.get(recipe.ingredient);
    const result = allEntities.get(recipe.result);
    if (!ingredient || ingredient.abstract || !result || result.abstract) {
      console.warn(
        `Deep frying recipe ${recipe.id}: unknown entity: ${
          !ingredient || ingredient.abstract ? recipe.ingredient : recipe.result
        }`
      );
      continue;
    }

    // Yes, you can deep fry a felionoid. No, we're not putting it in the
    // cookbook: mobs are excluded here for the same reason they're excluded
    // from butchering recipes, and a species mob has no sprite of its own to
    // draw anyway -- the game assembles it from humanoid appearance at runtime.
    if (ingredient.components.has('Body')) {
      console.warn(
        `Deep frying recipe ${recipe.id}: ignoring mob ingredient: ${
          recipe.ingredient
        }`
      );
      continue;
    }

    usedEntities.add(recipe.ingredient);
    usedEntities.add(recipe.result);
    specialRecipes.set(recipeId, {
      method: 'deepFry',
      time: recipe.time ?? DefaultDeepFryCookTime,
      solidResult: recipe.result,
      reagentResult: null,
      solids: {
        [recipe.ingredient]: 1,
      },
      reagents: {},
      group: recipe.group ?? DefaultRecipeGroup,
    });
  }
};

const addMetamorphRecipes = (
  metamorphRecipes: MetamorphRecipeMap,
  specialRecipes: Map<string, ResolvedSpecialRecipe>,
  usedEntities: Set<EntityId>,
  usedReagents: Set<ReagentId>,
  allEntities: ResolvedEntityMap,
  foodSequenceElements: FoodSequenceElementMap
): void => {
  outer: for (const recipe of metamorphRecipes.values()) {
    if (!recipe.rules || recipe.rules.length === 0) {
      console.warn(`Metamorph recipe ${recipe.id} has no rules`);
      continue;
    }

    // Metamorph recipes are built on food sequences. We need to find the start
    // point of the indicated food sequence.
    const startPoints = allEntities.values()
      .filter(ent => !ent.abstract && ent.foodSequenceStart?.key === recipe.key)
      .toArray();

    // At present, each food sequence key has exactly one start point. If we
    // can't find a single matching entity, skip the recipe.
    if (startPoints.length !== 1) {
      if (startPoints.length > 1) {
        console.warn(
          `Metamorph recipe ${
            recipe.id
          }: Multiple start points for food sequence '${
            recipe.key
          }'`
        );
      }
      continue;
    }

    const builder = new ConstructRecipeBuilder()
      .withSolidResult(recipe.result)
      .startWith(startPoints[0].id);

    // Now let's translate the rules into concrete steps.
    // Here we *could* reorder the rules so LastElementHasTags always
    // comes last, because it's weird to have a "Finish with" in the
    // middle of the instruction list, but luckily the data is already
    // ordered in a sane fashion. If this changes, well, fuck me.
    for (const rule of recipe.rules) {
      switch (rule['!type']) {
        case 'SequenceLength':
          // Can't really do anything meaningful with this - too weird and
          // complex to show in the UI.
          // TODO: Figure this out, somehow.
          break;
        case 'IngredientsWithTags': {
          const ingredients = findMetamorphIngredients(
            allEntities,
            recipe.key,
            foodSequenceElements,
            rule.tags,
            rule.needAll
          );
          if (ingredients === null) {
            console.warn(
              `Metamorph recipe ${
                recipe.id
              }: no matching ingredients: ${rule.tags.join(', ')}`
            );
            continue outer;
          }

          builder.addSolid(ingredients, rule.count.min, rule.count.max);
          break;
        }
        case 'LastElementHasTags': {
          const ingredients = findMetamorphIngredients(
            allEntities,
            recipe.key,
            foodSequenceElements,
            rule.tags,
            rule.needAll
          );
          if (ingredients === null) {
            console.warn(
              `Metamorph recipe ${
                recipe.id
              }: no matching ingredients: ${rule.tags.join(', ')}`
            );
            continue outer;
          }

          builder.endWith(ingredients);
          break;
        }
        case 'FoodHasReagent':
          builder.addReagent(rule.reagent, rule.count.min!, rule.count.max!);
          break;
        case 'ElementHasTags':
          // Not yet supported, not yet used - ignore it for now
          console.warn(
            `Metamorph recipe ${
              recipe.id
            }: unsupported rule: ${rule['!type']}`
          );
          continue outer;
        default:
          throw new Error(
            `${recipe.id}: Unknown metamorph recipe rule: ${(rule as any)['!type']}`
          );
      }
    }

    const finalRecipe = builder.toRecipe();
    collectRefs(usedEntities, usedReagents, finalRecipe);

    const recipeId = `m!${recipe.id}`;
    specialRecipes.set(recipeId, finalRecipe);
  }
};

const findMetamorphIngredients = (
  allEntities: ResolvedEntityMap,
  targetSequence: TagId,
  foodSequenceElements: FoodSequenceElementMap,
  tags: readonly TagId[],
  needAll = true
): OneOrMoreEntities | null => {
  let tagPred: (fse: FoodSequenceElementPrototype) => boolean;
  if (needAll) {
    tagPred = fse => {
      if (!fse.tags || fse.tags.length === 0) {
        return false;
      }
      for (const tag of tags) {
        if (!fse.tags.includes(tag)) {
          return false;
        }
      }
      return true;
    };
  } else {
    tagPred = fse => {
      if (!fse.tags || fse.tags.length === 0) {
        return false;
      }
      for (const tag of tags) {
        if (fse.tags?.includes(tag)) {
          return true;
        }
      }
      return false;
    };
  }

  // First, let's find all food sequence elements with matching tags.
  const elements = new Set(
    foodSequenceElements.values()
      .filter(tagPred)
      .map(fse => fse.id)
  );
  if (elements.size === 0) {
    return null;
  }

  // Second, let's find all entities that use any of the matching food
  // sequence elements in the target sequence.
  const entities = allEntities.values()
    .filter(ent => entityCanBeFoodSequenceElem(ent, elements, targetSequence))
    .map(ent => ent.id)
    .toArray();
  switch (entities.length) {
    case 0:
      return null;
    case 1:
      return entities[0];
    default:
      return entities;
  }
};

const entityCanBeFoodSequenceElem = (
  ent: ResolvedEntity,
  soughtIds: ReadonlySet<FoodSequenceElementId>,
  targetSequence: TagId
): boolean => {
  if (ent.abstract || !ent.foodSequenceElement) {
    return false;
  }
  const elem = ent.foodSequenceElement.get(targetSequence);
  if (!elem) {
    return false;
  }
  return soughtIds.has(elem.element);
};

const tryAddSpecialRecipes = (
  entity: ResolvedEntity,
  specialRecipes: Map<string, ResolvedSpecialRecipe>,
  usedEntities: Set<EntityId>,
  usedReagents: Set<ReagentId>,
  allEntities: ResolvedEntityMap,
  allConstructionGraphs: ConstructionGraphMap,
  allReagents: ReagentMap,
  ignoredSpecialRecipes: ReadonlySet<string>
): boolean => {
  // NOTE: We CANNOT treat slicing and constructing as mutually exclusive!
  // FoodDough can be cut into FoodDoughSlice *or* rolled into FoodDoughFlat.
  let addedAnything = false;

  const { sliceableFood, construction, deepFryOutput } = entity;

  // If this entity can be sliced to something that's used as an ingredient
  // (e.g. cheese wheel to cheese slice), then add a special recipe for it
  // *and* mark the current entity as used so we can find recipes for it.
  //
  // Note: We ignore things that can be sliced into non-ingredients, or we'd
  // end up with totally pointless cut recipes for every single type of cake
  // and pie, etc.
  if (
    sliceableFood?.slice != null &&
    usedEntities.has(sliceableFood.slice)
  ) {
    const recipeId = `cut!${entity.id}`;
    if (!specialRecipes.has(recipeId)) {
      const recipe = new ConstructRecipeBuilder()
        .withSolidResult(sliceableFood.slice)
        .withResultQty(sliceableFood.count)
        .startWith(entity.id)
        .cut()
        .toRecipe();
      collectRefs(usedEntities, usedReagents, recipe);
      specialRecipes.set(recipeId, recipe);
      addedAnything = true;
    }
  }

  // If the entity can be emptied into a container, it is a source of whatever
  // reagent that solution holds -- this is how a chef gets raw egg. Without
  // this the reagent looks like it has no origin at all, since nothing
  // *reacts* into it.
  if (entity.spiker) {
    const solution = findSolution(
      allEntities,
      entity,
      entity.spiker.solutionName
    );
    for (const reagent of solution?.reagents ?? []) {
      const proto = allReagents.get(reagent.ReagentId);
      if (
        !usedReagents.has(reagent.ReagentId) ||
        // Pills are spikeable too. Without this gate every medicine that
        // happens to share a reagent with a drink shows up as a "recipe".
        !proto ||
        !isFoodRelatedReagent(proto)
      ) {
        continue;
      }

      const recipeId = `spike!${entity.id}:${reagent.ReagentId}`;
      if (specialRecipes.has(recipeId) || ignoredSpecialRecipes.has(recipeId)) {
        continue;
      }

      const recipe = new ConstructRecipeBuilder()
        .withReagentResult(reagent.ReagentId)
        .withResultQty(reagent.Quantity)
        .startWith(entity.id)
        .spike(entity.spiker.verb)
        .toRecipe();
      collectRefs(usedEntities, usedReagents, recipe);
      specialRecipes.set(recipeId, recipe);
      addedAnything = true;
    }
  }

  // If the entity can be butchered by knife, we might be able to add a
  // recipe. The *input entity* must already be used, either as an ingredient
  // or as the result of some other recipe.
  if (
    entity.butcherable &&
    entity.butcherable.tool === 'Knife' &&
    entity.butcherable.spawned &&
    usedEntities.has(entity.id) &&
    tryAddCuttableSpawns(
      entity,
      entity.butcherable.spawned,
      specialRecipes,
      usedEntities,
      usedReagents,
      allEntities
    )
  ) {
    addedAnything = true;
  }
  if (
    entity.toolRefinable &&
    entity.toolRefinable.quality === 'Slicing' &&
    entity.toolRefinable.spawned &&
    tryAddCuttableSpawns(
      entity,
      entity.toolRefinable.spawned,
      specialRecipes,
      usedEntities,
      usedReagents,
      allEntities
    )
  ) {
    addedAnything = true;
  }

  // If this entity can be constructed into something relevant, then add
  // special recipes *and* mark the entity as used so we can find recipes
  // for it.
  for (const recipe of traverseConstructionGraph(
    entity.id,
    construction,
    allEntities,
    allConstructionGraphs
  )) {
    const { mainVerb } = recipe;
    const recipeId = mainVerb
      ? `${mainVerb}!${entity.id}`
      : `construct!${entity.id}:${recipe.solidResult}`;
    const shouldAddRecipe =
      !specialRecipes.has(recipeId) &&
      !ignoredSpecialRecipes.has(recipeId) &&
      (
        // Most methods must produce an ingredient, e.g. dough to flat dough.
        mainVerb !== 'heat' && usedEntities.has(recipe.solidResult!) ||
        // Heating produces things that don't have to be ingredients, e.g.
        // steak or boiled egg.
        mainVerb === 'heat'
      );
    if (shouldAddRecipe) {
      collectRefs(usedEntities, usedReagents, recipe);
      specialRecipes.set(recipeId, recipe);
      addedAnything = true;
    }
  }

  // Frontier: If the entity has a DeepFrySpawn, we can deep fry it. Crispy.
  if (deepFryOutput) {
    const recipeId = `deepFry!${entity.id}`;
    if (
      !specialRecipes.has(recipeId) &&
      !ignoredSpecialRecipes.has(recipeId)
    ) {
      usedEntities.add(entity.id);
      usedEntities.add(deepFryOutput);
      specialRecipes.set(recipeId, {
        method: 'deepFry',
        solidResult: deepFryOutput,
        reagentResult: null,
        solids: {
          [entity.id]: 1,
        },
        reagents: {},
        group: DefaultRecipeGroup,
      });
      addedAnything = true;
    }
  }

  return addedAnything;
};

const tryAddCuttableSpawns = (
  entity: ResolvedEntity,
  spawned: readonly EntitySpawnEntry[],
  specialRecipes: Map<string, ResolvedSpecialRecipe>,
  usedEntities: Set<EntityId>,
  usedReagents: Set<ReagentId>,
  allEntities: ResolvedEntityMap
): boolean => {
  if (
    // Don't add cuttables from mobs - don't want every single butcherable
    // mob to be present in the cookbook.
    entity.components.has('Body') ||
    // Don't add cuttables from *clothing* - you can get cloth from just about
    // every article of clothing.
    // ... unless it has the 'Bread' tag, in which case it's a baguette.
    // This is ugly and stupid.
    entity.components.has('Clothing') && !entity.tags.has('Bread' as TagId)
  ) {
    return false;
  }

  const spawns = getAllGuaranteedUsableSpawns(spawned);

  const canUseAtLeastOneSpawnedEntity = spawns.some(([id]) => {
    // We can use the entity if it's edible and used in at least one recipe.
    //
    // Basically, we want to catch burger buns, meat, breads and essentially
    // no other cuttables without hardcoding. There are SO MANY arbitrary
    // entities that can be cut.
    const spawned = allEntities.get(id)!;
    return (
      isEdible(spawned) &&
      (usedEntities.has(spawned.id) || spawned.foodSequenceStart)
    );
  });

  // If we can use at least one, add them all.
  let addedAnything = false;
  if (canUseAtLeastOneSpawnedEntity) {
    for (const [spawnedId, amount] of spawns) {
      const recipeId = `butcher!${entity.id}:${spawnedId}`;
      if (specialRecipes.has(recipeId)) {
        continue;
      }

      const builder = new ConstructRecipeBuilder()
        .withSolidResult(spawnedId)
        .withResultQty(amount)
        .startWith(entity.id)
        .cut();
      const otherSpawns = spawns
        .filter(e => e[0] !== spawnedId)
        .map(e => e[0]);
      if (otherSpawns.length > 0) {
        builder.alsoMakes(
          otherSpawns.length === 1
            ? otherSpawns[0]
            : otherSpawns
        );
      }
      const recipe = builder.toRecipe();
      collectRefs(usedEntities, usedReagents, recipe);
      specialRecipes.set(recipeId, recipe);
      addedAnything = true;
    }
  }
  return addedAnything;
};

const getAllGuaranteedUsableSpawns = (
  spawned: readonly EntitySpawnEntry[]
): [EntityId, number][] => {
  return spawned
    .filter(entry =>
      entry.id != null && // We need an entity ID
      !entry.orGroup && // We can't handle OR groups
      (entry.amount ?? 1) > 0 && // We need at least one
      (entry.prob ?? 1) === 1 // And the probability has to be 1
    )
    .map(entry => [entry.id!, entry.amount ?? 1] as const);
};

const isEdible = (entity: ResolvedEntity): boolean =>
  entity.components.has('Food') || // Legacy component
  entity.components.has('Edible'); // New thing

const collectRefs = (
  usedEntities: Set<EntityId>,
  usedReagents: Set<ReagentId>,
  recipe: ResolvedSpecialRecipe
): void => {
  if (recipe.solidResult) {
    usedEntities.add(recipe.solidResult);
  }
  if (recipe.reagentResult) {
    usedReagents.add(recipe.reagentResult);
  }
  for (const id of Object.keys(recipe.solids)) {
    usedEntities.add(id as EntityId);
  }
  for (const id of Object.keys(recipe.reagents)) {
    usedReagents.add(id as ReagentId);
  }
};

const tryAddReaction = (
  reactions: Map<ReactionId, ReactionPrototype>,
  reaction: ReactionPrototype,
  usedEntities: Set<EntityId>,
  usedReagents: Set<ReagentId>,
  allReagents: ReagentMap
): boolean => {
  if (reactions.has(reaction.id)) {
    // We already have this reaction, don't process it again
    return false;
  }

  // Some reactions can only occur in centrifuges, electrolysers and, for
  // whatever reason, by being bashed with a bible. We ignore any reaction
  // without a supported mixer category.
  if (
    reaction.requiredMixerCategories != null &&
    reaction.requiredMixerCategories.length !== 0 &&
    !reaction.requiredMixerCategories.some(c => MixerCategoryToStepType.has(c))
  ) {
    return false;
  }

  // We only add reactions that produce exactly one reagent xor
  // exactly one solid (entity). Something like the ambuzol+ reaction
  // yields two reagents (ambuzol+ and blood), so would never be included
  // by this code. To my knowledge there are no reactions that spawn
  // multiple entities, but we can't rule out the possibility that
  // such a reaction might be added in future.
  const reagentResult = getReagentResult(reaction);
  const solidResult = getSolidResult(reaction);

  if (!reagentResult === !solidResult) {
    // We have neither or both: can't do anything, just return.
    return false;
  }

  const needsReaction =
    // We need this reaction if anything uses the reagent it produces...
    (
      reagentResult &&
      usedReagents.has(reagentResult[0]) &&
      isFoodRelatedReagent(allReagents.get(reagentResult[0])!)
    ) ||
    // ... or if anything uses the *solid* it produces.
    solidResult && usedEntities.has(solidResult);
  if (!needsReaction) {
    return false;
  }

  reactions.set(reaction.id, reaction);

  // Now we must go through this reaction's reactants, and add any that haven't
  // already been added by a recipe or other reaction. If we add new reagents,
  // we must visit the entire reaction list again to find if anything makes
  // those reagents, until we run out of reactions or new reagents.
  let hasNewReagents = false;
  for (const id of Object.keys(reaction.reactants)) {
    if (!usedReagents.has(id as ReagentId)) {
      usedReagents.add(id as ReagentId);
      hasNewReagents = true;
    }
  }
  return hasNewReagents;
};

const isFoodRelatedReagent = (reagent: ReagentPrototype): boolean =>
  reagent.group === 'Foods' ||
  reagent.group === 'Drinks';

function* traverseConstructionGraph(
  entityId: EntityId,
  constr: ResolvedConstruction | null,
  allEntities: ResolvedEntityMap,
  allConstructionGraphs: ConstructionGraphMap
): Generator<ResolvedConstructionRecipe> {
  if (
    !constr ||
    constr.graph == null || constr.node == null ||
    // We can't handle entities in the middle of construction
    constr.edge != null || constr.step != null
  ) {
    return;
  }

  const graph = allConstructionGraphs.get(constr.graph);
  if (!graph) {
    console.warn(
      `Entity '${entityId}': Unknown construction graph: ${constr.graph}`
    );
    return;
  }

  // This construction graph traversal is *extremely* simplified compared to
  // what the game does, because we're only really looking for simple things.
  const startNode = graph.graph.find(n => n.node === constr.node);
  if (!startNode || !startNode.edges) {
    // Broken construction graph or we're at an end node with no edges
    return;
  }

  for (const edge of startNode.edges) {
    if (edge.conditions && edge.conditions.length > 0) {
      // Can't currently handle conditions
      continue;
    }
    const target = graph.graph.find(n => n.node === edge.to);
    if (!target) {
      // Broken construction graph :(
      continue;
    }

    const { steps } = edge;
    if (
      steps?.length !== 1 || // No support for multi-step construction
      target.entity == null ||
      target.entity === entityId
    ) {
      continue;
    }

    const step = steps[0];
    if (step.tool === 'Rolling') {
      yield new ConstructRecipeBuilder()
        .withSolidResult(target.entity)
        .startWith(entityId)
        .roll()
        .toRecipe();
    }
    if (step.minTemperature != null && step.maxTemperature == null) {
      yield new ConstructRecipeBuilder()
        .withSolidResult(target.entity)
        .startWith(entityId)
        .heat(step.minTemperature)
        .toRecipe();
    }
    if (step.tag) {
      const usableEntities = findTargetEntityByTag(step.tag, allEntities);
      if (usableEntities) {
        yield new ConstructRecipeBuilder()
          .withSolidResult(target.entity)
          .startWith(entityId)
          .addSolid(usableEntities)
          .toRecipe();
      }
    }
  }
}

const findTargetEntityByTag = (
  tag: TagId,
  allEntities: ResolvedEntityMap
): OneOrMoreEntities | null => {
  const matching = allEntities.values()
    .filter(ent => !ent.abstract && ent.tags.has(tag))
    .map(ent => ent.id)
    .toArray();
  switch (matching.length) {
    case 0:
      return null;
    case 1:
      return matching[0];
    default:
      return matching;
  }
};

const collectReagentSources = (
  allEntities: ResolvedEntityMap,
  usedEntities: Set<EntityId>,
  usedReagents: Set<ReagentId>,
  ignoreSourcesOf: ReadonlySet<ReagentId>,
  forceIncludeReagentSources: ReadonlyMap<ReagentId, readonly EntityId[]>
): Map<ReagentId, ResolvedReagentSource[]> => {
  const result = new Map<ReagentId, ResolvedReagentSource[]>();

  const addSource = (
    reagentId: ReagentId,
    source: ResolvedReagentSource
  ): void => {
    const existing = result.get(reagentId);
    // An entity can yield the same reagent from both its grind and its juice
    // solution -- cocoa beans do -- so dedupe on the pair, not the entity.
    if (existing?.some(s =>
      s.entity === source.entity && s.method === source.method
    )) {
      return;
    }
    appendAtKey(result, reagentId, source);
  };

  for (const entity of allEntities.values()) {
    if (entity.abstract) {
      continue;
    }

    const sourceOf = findGrindableProduceReagents(
      entity,
      usedReagents,
      allEntities
    );
    if (sourceOf && sourceOf.length > 0) {
      usedEntities.add(entity.id);
      for (const { reagentId, method } of sourceOf) {
        if (ignoreSourcesOf.has(reagentId)) {
          continue;
        }

        addSource(reagentId, { entity: entity.id, method });
      }
    }
  }

  for (const [reagentId, sources] of forceIncludeReagentSources) {
    if (!usedReagents.has(reagentId)) {
      continue;
    }

    for (const entityId of sources) {
      usedEntities.add(entityId);
      // No method: the fork tells us the entity, not how to get the reagent
      // out of it. Butter goes in a beaker; eggs get cracked.
      addSource(reagentId, { entity: entityId });
    }
  }

  return result;
};

interface GrindableReagent {
  readonly reagentId: ReagentId;
  readonly method: ReagentSourceMethod;
}

const findGrindableProduceReagents = (
  entity: ResolvedEntity,
  usedReagents: Set<ReagentId>,
  allEntities: ResolvedEntityMap
): GrindableReagent[] | null => {
  const { isProduce, extractable, solutions } = entity;

  if (
    !extractable ||
    !solutions ||
    // Don't show random grindable objects, just plants that can be grown.
    !isProduce
  ) {
    return null;
  }

  const foundSolutions: [Solution, ReagentSourceMethod][] = [];

  const grindSolution =
    extractable.grindSolutionName &&
    findSolution(allEntities, entity, extractable.grindSolutionName);
  if (grindSolution && grindSolution.reagents) {
    foundSolutions.push([grindSolution, 'grind']);
  }
  if (extractable.juiceSolution?.reagents) {
    foundSolutions.push([extractable.juiceSolution, 'juice']);
  }

  if (foundSolutions.length === 0) {
    return null;
  }

  return foundSolutions.flatMap(([solution, method]) =>
    solution.reagents!
      .filter(reagent => usedReagents.has(reagent.ReagentId))
      .map(reagent => ({ reagentId: reagent.ReagentId, method }))
  );
};

interface FoodSequences {
  startPoints: Map<TagId, EntityId[]>;
  elements: Map<TagId, EntityId[]>;
  endPoints: Map<TagId, EntityId[]>;
}

const collectFoodSequences = (
  usedEntities: Set<EntityId>,
  allEntities: ResolvedEntityMap,
  ignoredFoodSequenceElements: ReadonlySet<EntityId>
): FoodSequences => {
  const startPoints = new Map<TagId, EntityId[]>();
  for (const id of usedEntities.values()) {
    const { foodSequenceStart } = allEntities.get(id)!;
    if (foodSequenceStart?.key) {
      appendAtKey(startPoints, foodSequenceStart.key, id);
    }
  }

  const elements = new Map<TagId, EntityId[]>();
  const endPoints = new Map<TagId, EntityId[]>();
  for (const entity of allEntities.values()) {
    if (
      entity.abstract ||
      !entity.foodSequenceElement ||
      entity.foodSequenceElement.size === 0 ||
      ignoredFoodSequenceElements.has(entity.id)
    ) {
      continue;
    }

    usedEntities.add(entity.id);

    for (const [key, elem] of entity.foodSequenceElement) {
      if (!startPoints.has(key)) {
        continue;
      }
      appendAtKey(elem.final ? endPoints : elements, key, entity.id);
    }
  }
  return { startPoints, elements, endPoints };
};

const appendAtKey = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  let values = map.get(key);
  if (!values) {
    values = [];
    map.set(key, values);
  }
  values.push(value);
};
