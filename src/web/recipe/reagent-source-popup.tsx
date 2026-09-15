import { cloneElement, ReactElement, Ref } from 'react';
import {
  ReagentEntitySource,
  ReagentSource,
} from '../../types';
import { useGameData } from '../context';
import { Popup, usePopupTrigger } from '../popup';
import { EntitySprite } from '../sprites';
import { EntitySourceList } from './entity-source-popup';
import { SourceRecipe, SourceResult } from './source-recipe';

export interface Props {
  resultId: string;
  targetResultQty?: number;
  sources: readonly ReagentSource[];
  children: ReactElement<{
    ref?: Ref<HTMLElement>
  }>;
}

/**
 * Shows non-recipe ways to obtain a reagent: extracting it from an entity or
 * getting a package containing it from a vending machine.
 */
export const ReagentSourcePopup = ({
  resultId,
  targetResultQty,
  sources,
  children,
}: Props): ReactElement => {
  const popup = usePopupTrigger();

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
        <ReagentSourceList
          result={{ type: 'reagent', id: resultId }}
          sources={sources}
          targetResultQty={targetResultQty}
        />
      </div>
    </Popup>
  </>;
};

/** The non-recipe source content, reusable inside a combined recipe popup. */
export const ReagentSourceList = ({
  result,
  sources,
  targetResultQty,
}: {
  result: SourceResult;
  sources: readonly ReagentSource[];
  targetResultQty?: number;
}): ReactElement => {
  // Sources with different yields need separate cards so the output quantity
  // in each header remains accurate.
  const groups = new Map<
    string,
    ReagentEntitySource[]
  >();
  for (const source of sources.filter(s => s.type !== 'vending')) {
    const key = `${source.method ?? 'other'}\0${source.amount ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(source);
  }
  const vendingSources = sources
    .filter(source => source.type === 'vending')
    .map(source => ({
      type: 'vending' as const,
      container: source.container,
      vendor: source.vendor,
      stock: source.stock,
    }));

  return (
    <>
      {Array.from(groups, ([key, group]) => {
        const { method, amount } = group[0];
        // Grinding and juicing consume whole entities and always extract the
        // entity's full solution. Scale in whole-item batches, then show the
        // actual amount produced (which may exceed the requested amount).
        const sourceQty = amount
          ? Math.max(1, Math.ceil((targetResultQty ?? amount) / amount))
          : undefined;
        const resultQty = amount && sourceQty != null
          ? amount * sourceQty
          : targetResultQty;
        return <SourceRecipe
          key={key}
          result={result}
          resultQty={resultQty}
          method={method}
        >
          {group.map(source =>
            <SourceEntity
              key={source.entity}
              id={source.entity}
              quantity={sourceQty ?? 1}
            />
          )}
        </SourceRecipe>;
      })}
      {vendingSources.length > 0 && (
        <EntitySourceList result={result} sources={vendingSources}/>
      )}
    </>
  );
};

interface SourceEntityProps {
  id: string;
  quantity?: number;
}

const SourceEntity = ({ id, quantity }: SourceEntityProps): ReactElement => {
  const { entityMap } = useGameData();
  const entity = entityMap.get(id);

  return (
    <span className='recipe_ingredient'>
      <EntitySprite id={id}/>
      <span>
        {quantity != null ? `${formatAmount(quantity)} ` : null}
        {entity?.name ?? id}
      </span>
    </span>
  );
};

const formatAmount = (amount: number): string =>
  String(Math.round(amount * 1000) / 1000);
