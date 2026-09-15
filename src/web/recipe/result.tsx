import { ReactElement, memo } from 'react';
import { Recipe } from '../../types';
import { useGameData } from '../context';
import { EntitySprite, ReagentSprite } from '../sprites';
import { Tooltip } from '../tooltip';

export interface RecipeResultProps {
  recipe: Recipe;
  /** Override the recipe's normal output quantity for a scaled display. */
  resultQty?: number;
}

export const RecipeResult = memo(({
  recipe,
  resultQty: resultQtyOverride,
}: RecipeResultProps): ReactElement => {
  const { entityMap, reagentMap } = useGameData();

  const solidResult = recipe.solidResult
    ? entityMap.get(recipe.solidResult)
    : undefined;
  const reagentResult = recipe.reagentResult
    ? reagentMap.get(recipe.reagentResult)
    : undefined;
  const resultQty = resultQtyOverride ?? recipe.resultQty ?? 1;

  if (solidResult) {
    return (
      <span className='recipe_result'>
        <EntitySprite id={solidResult.id}/>
        <span className='recipe_name'>{solidResult.name}</span>
        {resultQty > 1 && (
          <Tooltip text={`This recipe makes ${resultQty}.`}>
            <span className='recipe_result-qty'>
              {resultQty}
            </span>
          </Tooltip>
        )}
      </span>
    );
  }
  if (reagentResult) {
    const { id: resultId, name: resultName } = reagentResult;
    return (
      <span className='recipe_result'>
        <ReagentSprite id={resultId} glass/>
        <span className='recipe_name'>
          {resultName}
        </span>
        <Tooltip
          text={
            `The recipe makes ${
              resultQty
            }u ${
              resultName
            } with the amounts shown.`
          }
        >
          <span className='recipe_result-qty'>
            {`${resultQty}u`}
          </span>
        </Tooltip>
      </span>
    );
  }
  return <span>ERROR!</span>;
});
