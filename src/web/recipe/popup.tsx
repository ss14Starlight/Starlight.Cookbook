import { cloneElement, ReactElement, Ref } from 'react';
import { useGameData } from '../context';
import { Popup, usePopupTrigger } from '../popup';
import { EntitySourceList } from './entity-source-popup';
import { ReagentSourceList } from './reagent-source-popup';
import { Recipe } from './recipe';

export interface Props {
  id: string | readonly string[];
  /** Scale reagent recipes to make this many units. */
  targetResultQty?: number;
  children: ReactElement<{
    ref?: Ref<HTMLElement>
  }>;
}

export const RecipePopup = ({
  id,
  targetResultQty,
  children,
}: Props): ReactElement => {
  const popup = usePopupTrigger();
  const { entityMap, reagentMap, recipeMap } = useGameData();
  const firstRecipeId = typeof id === 'string' ? id : id[0];
  const firstRecipe = recipeMap.get(firstRecipeId)!;
  const entitySources = firstRecipe.solidResult
    ? entityMap.get(firstRecipe.solidResult)?.sources
    : undefined;
  const reagentSources = firstRecipe.reagentResult
    ? reagentMap.get(firstRecipe.reagentResult)?.sources
    : undefined;

  const childWithRef = cloneElement(children, {
    ref: popup.triggerRef,
  });

  return <>
    {childWithRef}
    <Popup
      {...popup}
      placement='below'
      interactive
    >
      <div className='popup_recipe'>
        {typeof id === 'string'
          ? renderRecipe(id, targetResultQty)
          : id.map(recipeId => renderRecipe(recipeId, targetResultQty))}
        {entitySources && entitySources.length > 0
          ? <EntitySourceList
              result={{ type: 'entity', id: firstRecipe.solidResult! }}
              sources={entitySources}
            />
          : null}
        {reagentSources && reagentSources.length > 0
          ? <ReagentSourceList
              result={{ type: 'reagent', id: firstRecipe.reagentResult! }}
              sources={reagentSources}
              targetResultQty={targetResultQty}
            />
          : null}
      </div>
    </Popup>
  </>;
};

const renderRecipe = (
  id: string,
  targetResultQty?: number
): ReactElement =>
  <Recipe
    key={id}
    id={id}
    targetResultQty={targetResultQty}
    canExplore={false}
    canFavorite={false}
    skipDefaultHeaderAction
  />;
