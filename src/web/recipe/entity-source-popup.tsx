import {
  cloneElement,
  ReactElement,
  Ref,
  useEffect,
  useState,
} from 'react';
import { EntitySource } from '../../types';
import { useGameData } from '../context';
import { Popup, usePopupTrigger } from '../popup';
import { EntitySprite } from '../sprites';
import { SourceRecipe, SourceResult } from './source-recipe';

export interface Props {
  resultId: string;
  sources: readonly EntitySource[];
  children: ReactElement<{
    ref?: Ref<HTMLElement>
  }>;
}

/** Shows non-recipe ways to obtain a solid ingredient. */
export const EntitySourcePopup = ({
  resultId,
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
        <EntitySourceList
          result={{ type: 'entity', id: resultId }}
          sources={sources}
        />
      </div>
    </Popup>
  </>;
};

/** The vending-source content, reusable inside a combined recipe popup. */
export const EntitySourceList = ({
  result,
  sources,
}: {
  result: SourceResult;
  sources: readonly EntitySource[];
}): ReactElement => {
  const { entityMap } = useGameData();
  const byContainer = new Map<string | undefined, EntitySource[]>();
  for (const source of sources) {
    const group = byContainer.get(source.container);
    if (group) {
      group.push(source);
    } else {
      byContainer.set(source.container, [source]);
    }
  }

  return (
    <>
      {Array.from(byContainer, ([container, group]) => {
        const vendors = new Map<string, string[]>();
        for (const source of group) {
          const name = entityMap.get(source.vendor)?.name ?? source.vendor;
          const ids = vendors.get(name);
          if (ids) {
            ids.push(source.vendor);
          } else {
            vendors.set(name, [source.vendor]);
          }
        }

        return (
          <SourceRecipe
            key={container ?? 'loose'}
            result={container
              ? { type: 'entity', id: container }
              : result}
          >
            {Array.from(vendors, ([name, ids]) =>
              <SourceVendor key={name} name={name} ids={ids}/>
            )}
          </SourceRecipe>
        );
      })}
    </>
  );
};

interface SourceVendorProps {
  name: string;
  ids: readonly string[];
}

const SourceVendor = ({ name, ids }: SourceVendorProps): ReactElement => {
  const { entityMap } = useGameData();
  const spriteIds: string[] = [];
  const spritePositions = new Set<string>();
  for (const id of ids) {
    const sprite = entityMap.get(id)?.sprite;
    if (!sprite) {
      continue;
    }
    const key = sprite.join(',');
    if (!spritePositions.has(key)) {
      spritePositions.add(key);
      spriteIds.push(id);
    }
  }

  const [spriteIndex, setSpriteIndex] = useState(0);
  useEffect(() => {
    if (spriteIds.length < 2) {
      return;
    }
    const interval = window.setInterval(() => {
      setSpriteIndex(index => (index + 1) % spriteIds.length);
    }, 1500);
    return () => window.clearInterval(interval);
  }, [spriteIds.length]);

  const spriteId = spriteIds[spriteIndex] ?? ids[0];

  return (
    <span className='recipe_ingredient'>
      <EntitySprite id={spriteId}/>
      <span>{name}</span>
    </span>
  );
};
