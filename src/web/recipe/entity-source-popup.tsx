import {
  cloneElement,
  ReactElement,
  Ref,
  useEffect,
  useState,
} from 'react';
import { EntitySource, VendingStock } from '../../types';
import { useGameData } from '../context';
import { Popup, usePopupTrigger } from '../popup';
import { EntitySprite } from '../sprites';

export interface Props {
  sources: readonly EntitySource[];
  children: ReactElement<{
    ref?: Ref<HTMLElement>
  }>;
}

/** Shows non-recipe ways to obtain a solid ingredient. */
export const EntitySourcePopup = ({
  sources,
  children,
}: Props): ReactElement => {
  const popup = usePopupTrigger();
  const { entityMap } = useGameData();
  const childWithRef = cloneElement(children, {
    ref: popup.triggerRef,
  });

  const byStock = new Map<VendingStock, EntitySource[]>();
  for (const source of sources) {
    let group = byStock.get(source.stock);
    if (!group) {
      group = [];
      byStock.set(source.stock, group);
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
      <div className='popup_entity-source'>
        {Array.from(byStock, ([stock, group]) => {
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
            <div key={stock} className='entity-source'>
              <div className='entity-source_verb'>
                {StockText[stock](vendors.size)}
              </div>
              {Array.from(vendors, ([name, ids]) =>
                <SourceVendor key={name} name={name} ids={ids}/>
              )}
            </div>
          );
        })}
      </div>
    </Popup>
  </>;
};

const StockText: Readonly<Record<
  VendingStock,
  (count: number) => string
>> = {
  starting: count => count === 1 ? 'Vended from:' : 'Vended from any of:',
  contraband: count => count === 1
    ? 'Contraband stock in:'
    : 'Contraband stock in any of:',
  emagged: count => count === 1
    ? 'Emag-only stock in:'
    : 'Emag-only stock in any of:',
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
