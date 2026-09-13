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
}

const IngredientSpriteHeight = 32;
const ReagentContainerInstructionHeight = 24;

export const RecipeIngredients = memo(({
  visible,
  solids,
  reagents,
  reagentContainerName,
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
        amount={ingredient.amount}
        catalyst={ingredient.catalyst}
      />
    );

  return (
    <div className='recipe_ingredients'>
      {Object.entries(solids).map(([entId, qty]) =>
        <SolidIngredient key={entId} id={entId} qty={qty}/>
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
        {qty != null ? `${qty} ` : null}
        {relatedRecipes ? (
          <RecipePopup id={relatedRecipes}>
            <span className='more-info'>
              {entity.name}
            </span>
          </RecipePopup>
        ) : entity.sources && entity.sources.length > 0 ? (
          <EntitySourcePopup sources={entity.sources}>
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
    ? `${amount}u `
    : `${amount[0]}–${amount[1]}u `;

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
          <RecipePopup id={relatedRecipes}>
            <span className='more-info'>
              {reagent.name}
            </span>
          </RecipePopup>
        ) : reagent.sources.length > 0 ? (
          <ReagentSourcePopup sources={reagent.sources}>
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
