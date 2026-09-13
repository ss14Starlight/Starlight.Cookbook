import { cloneElement, ReactElement, Ref } from 'react';
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
        {Array.from(byStock, ([stock, group]) =>
          <div key={stock} className='entity-source'>
            <div className='entity-source_verb'>
              {StockText[stock](group.length)}
            </div>
            {group.map(source =>
              <SourceVendor key={source.vendor} id={source.vendor}/>
            )}
          </div>
        )}
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
  id: string;
}

const SourceVendor = ({ id }: SourceVendorProps): ReactElement => {
  const { entityMap } = useGameData();
  const entity = entityMap.get(id);

  return (
    <span className='recipe_ingredient'>
      <EntitySprite id={id}/>
      <span>{entity?.name ?? id}</span>
    </span>
  );
};
