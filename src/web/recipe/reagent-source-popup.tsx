import { cloneElement, ReactElement, Ref } from 'react';
import { ReagentSource, ReagentSourceMethod } from '../../types';
import { useGameData } from '../context';
import { Popup, usePopupTrigger } from '../popup';
import { EntitySprite } from '../sprites';

export interface Props {
  sources: readonly ReagentSource[];
  children: ReactElement<{
    ref?: Ref<HTMLElement>
  }>;
}

/**
 * Shown when hovering a reagent that isn't produced by any recipe, but *can*
 * be extracted from an entity: cinnamon out of a cinnamon stick, flour out of
 * a wheat bushel. These aren't recipes -- there'd be dozens of them and each
 * would be a single ingredient with a single step -- so the information lives
 * here instead of in the recipe list.
 */
export const ReagentSourcePopup = ({
  sources,
  children,
}: Props): ReactElement => {
  const popup = usePopupTrigger();

  const childWithRef = cloneElement(children, {
    ref: popup.triggerRef,
  });

  // Group by method so each verb is named once, however many entities it
  // covers. Insertion order gives us grind before juice, matching the order
  // the generator walks the solutions in.
  const byMethod = new Map<ReagentSourceMethod | undefined, ReagentSource[]>();
  for (const source of sources) {
    let group = byMethod.get(source.method);
    if (!group) {
      group = [];
      byMethod.set(source.method, group);
    }
    group.push(source);
  }

  return <>
    {childWithRef}
    <Popup
      {...popup}
      placement='below'
      interactive
    >
      <div className='popup_reagent-source'>
        {Array.from(byMethod, ([method, group]) =>
          <div key={method ?? 'other'} className='reagent-source'>
            <div className='reagent-source_verb'>
              {MethodText[method ?? 'other'](group.length)}
            </div>
            {group.map(source =>
              <SourceEntity key={source.entity} id={source.entity}/>
            )}
          </div>
        )}
      </div>
    </Popup>
  </>;
};

const MethodText: Readonly<Record<
  ReagentSourceMethod | 'other',
  (count: number) => string
>> = {
  grind: count => count === 1 ? 'Grind:' : 'Grind any of:',
  juice: count => count === 1 ? 'Juice:' : 'Juice any of:',
  // No method recorded, so stay vague rather than tell the player to grind
  // a stick of butter.
  other: count => count === 1 ? 'Comes from:' : 'Comes from any of:',
};

interface SourceEntityProps {
  id: string;
}

const SourceEntity = ({ id }: SourceEntityProps): ReactElement => {
  const { entityMap } = useGameData();
  const entity = entityMap.get(id);

  return (
    <span className='recipe_ingredient'>
      <EntitySprite id={id}/>
      <span>{entity?.name ?? id}</span>
    </span>
  );
};
