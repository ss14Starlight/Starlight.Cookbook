import { ReactElement, ReactNode } from 'react';
import { ReagentSourceMethod } from '../../types';
import { useGameData } from '../context';
import { EntitySprite, RawSprite, ReagentSprite } from '../sprites';

export type SourceResult =
  | { readonly type: 'entity'; readonly id: string }
  | { readonly type: 'reagent'; readonly id: string };

interface Props {
  result: SourceResult;
  resultQty?: number;
  method?: ReagentSourceMethod;
  children: ReactNode;
}

/** Presents a non-recipe source using the same card layout as a recipe. */
export const SourceRecipe = ({
  result,
  resultQty,
  method,
  children,
}: Props): ReactElement => {
  const { entityMap, reagentMap, methodSprites } = useGameData();
  const resultName = result.type === 'entity'
    ? entityMap.get(result.id)?.name ?? result.id
    : reagentMap.get(result.id)?.name ?? result.id;
  const methodSprite = method ? methodSprites[method] : undefined;

  return (
    <div className='recipe'>
      <div className='recipe_title'>
        <span className='recipe_result'>
          {result.type === 'entity'
            ? <EntitySprite id={result.id}/>
            : <ReagentSprite id={result.id} glass/>}
          <span className='recipe_name'>{resultName}</span>
          {result.type === 'reagent' && resultQty != null ? (
            <span className='recipe_result-qty'>{formatAmount(resultQty)}u</span>
          ) : null}
        </span>
      </div>
      <div className='recipe_ingredients'>
        {children}
      </div>
      {method && methodSprite ? (
        <div className='recipe_method'>
          <RawSprite position={methodSprite} alt='reagent grinder'/>
          <span>{MethodLabel[method]}</span>
        </div>
      ) : null}
    </div>
  );
};

const MethodLabel: Readonly<Record<ReagentSourceMethod, string>> = {
  grind: 'Grind',
  juice: 'Juice',
};

const formatAmount = (amount: number): string =>
  String(Math.round(amount * 1000) / 1000);
