import { ReactElement, memo } from 'react';
import { ReagentIngredient as ReagentIngredientData } from '../../types';
import { useGameData } from '../context';
import { EntitySprite, ReagentSprite } from '../sprites';
import { Tooltip } from '../tooltip';
import { RecipePopup } from './popup';
import { EntitySourcePopup } from './entity-source-popup';
import { ReagentSourcePopup } from './reagent-source-popup';

export interface RecipeIngredientsProps {
  visible: boolean;
  solids: Readonly<Record<string, number>>;
  reagents: Readonly<Record<string, ReagentIngredientData>>;
  /** If set, tells the user that the listed reagents go in this container. */
  reagentContainerName?: string;
  /** Multiplier applied to reagent amounts. */
  quantityScale?: number;
}

const IngredientSpriteHeight = 32;
const ReagentContainerInstructionHeight = 24;

export const RecipeIngredients = memo(({
  visible,
  solids,
  reagents,
  reagentContainerName,
  quantityScale = 1,
}: RecipeIngredientsProps): ReactElement => {
  if (!visible) {
    const ingredientCount =
      Object.keys(solids).length +
      Object.keys(reagents).length;
    const instructionHeight = reagentContainerName
      ? ReagentContainerInstructionHeight
      : 0;
    return (
      <div
        className='recipe_ingredients'
        style={{
          height: `${
            ingredientCount * IngredientSpriteHeight + instructionHeight
          }px`,
        }}
      />
    );
  }

  const reagentIngredients = Object.entries(reagents)
    .map(([reagentId, ingredient]) =>
      <ReagentIngredient
        key={reagentId}
        id={reagentId}
        amount={ingredient.catalyst
          ? ingredient.amount
          : scaleAmount(ingredient.amount, quantityScale)}
        catalyst={ingredient.catalyst}
      />
    );

  return (
    <div className='recipe_ingredients'>
      {Object.entries(solids).map(([entId, qty]) =>
        <SolidIngredient
          key={entId}
          id={entId}
          qty={scaleAmount(qty, quantityScale)}
        />
      )}
      {reagentContainerName ? (
        <div className='recipe_reagent-group'>
          <span className='recipe_reagent-instruction'>
            Put these in the {reagentContainerName}:
          </span>
          {reagentIngredients}
        </div>
      ) : reagentIngredients}
    </div>
  );
});

export const scaleAmount = (amount: number, scale: number): number =>
  Math.round(amount * scale * 1000) / 1000;

export const formatAmount = (amount: number): string =>
  String(scaleAmount(amount, 1));

export interface SolidIngredientProps {
  id: string;
  qty?: number;
}

export const SolidIngredient = ({
  id,
  qty,
}: SolidIngredientProps): ReactElement => {
  const { entityMap, recipesBySolidResult } = useGameData();
  const entity = entityMap.get(id)!;
  const relatedRecipes = recipesBySolidResult.get(id);

  return (
    <span className='recipe_ingredient'>
      <EntitySprite id={id}/>
      <span>
        {qty != null ? `${formatAmount(qty)} ` : null}
        {relatedRecipes ? (
          <RecipePopup id={relatedRecipes}>
            <span className='more-info'>
              {entity.name}
            </span>
          </RecipePopup>
        ) : entity.sources && entity.sources.length > 0 ? (
          <EntitySourcePopup resultId={id} sources={entity.sources}>
            <span className='more-info'>
              {entity.name}
            </span>
          </EntitySourcePopup>
        ) : entity.name}
      </span>
    </span>
  );
};

export interface ReagentIngredientProps {
  id: string;
  /** Single amount (in units), or [min, max]. */
  amount: number | readonly [number, number];
  catalyst?: boolean;
}

export const ReagentIngredient = ({
  id,
  amount,
  catalyst = false,
}: ReagentIngredientProps): ReactElement => {
  const { reagentMap, recipesByReagentResult } = useGameData();
  const reagent = reagentMap.get(id)!;
  const relatedRecipes = recipesByReagentResult.get(id);

  const formattedAmount = typeof amount === 'number'
    ? `${formatAmount(amount)}u `
    : `${formatAmount(amount[0])}–${formatAmount(amount[1])}u `;

  return (
    <span className='recipe_ingredient'>
      <ReagentSprite id={id}/>
      <span>
        {formattedAmount}
        {/*
          * A reagent you react into something has recipes; one you extract
          * from an entity has sources. Reactions win where a reagent has
          * both, since the recipe already names the entity it comes from.
          */}
        {relatedRecipes ? (
          <RecipePopup
            id={relatedRecipes}
            targetResultQty={typeof amount === 'number' ? amount : undefined}
          >
            <span className='more-info'>
              {reagent.name}
            </span>
          </RecipePopup>
        ) : reagent.sources.length > 0 ? (
          <ReagentSourcePopup
            resultId={id}
            targetResultQty={typeof amount === 'number' ? amount : undefined}
            sources={reagent.sources}
          >
            <span className='more-info'>
              {reagent.name}
            </span>
          </ReagentSourcePopup>
        ) : reagent.name}
        {catalyst && <>
          {' '}
          <Tooltip
            text={
              `You won’t lose any of the ${
                reagent.name
              } when making this recipe.`
            }
          >
            <span className='recipe_catalyst'>
              catalyst
            </span>
          </Tooltip>
        </>}
      </span>
    </span>
  );
};
