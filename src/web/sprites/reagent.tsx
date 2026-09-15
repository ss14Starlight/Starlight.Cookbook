import { ReactElement, memo } from 'react';
import { useGameData } from '../context';
import { RawSprite } from './raw';

export interface ReagentSpriteProps {
  id: string;
  glass?: boolean;
}

export const ReagentSprite = memo(({
  id,
  glass = false,
}: ReagentSpriteProps): ReactElement => {
  const {
    reagentMap,
    methodSprites: { mix: beakerPosition },
    beakerFill,
  } = useGameData();

  const reagent = reagentMap.get(id)!;

  if (glass && reagent.sprite) {
    return <RawSprite position={reagent.sprite} alt={`${reagent.name} glass`}/>;
  }

  const maskPosition = `-${beakerFill[0]}px -${beakerFill[1]}px`;

  return (
    <span className='reagent'>
      <RawSprite position={beakerPosition!} alt='beaker'/>
      <span
        className='reagent_fill'
        style={{
          backgroundColor: reagent.color,
          WebkitMaskPosition: maskPosition,
          maskPosition,
        }}
      />
    </span>
  );
});
