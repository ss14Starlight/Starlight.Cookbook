import { ReactElement, memo } from 'react';
import {
  AddReagentStep,
  AddStep,
  AlsoMakesStep,
  ConstructionStep,
  EndStep,
  HeatMixtureStep,
  HeatStep,
  MixStep,
  SimpleInteractionStep,
  SpikeStep,
  StartStep,
} from '../../types';
import { useGameData } from '../context';
import { RawSprite } from '../sprites';
import { Temperature } from '../temperature';
import {
  ReagentIngredient,
  RecipeIngredients,
  SolidIngredient,
  scaleAmount,
} from './ingredients';

export interface RecipeInstructionsProps {
  steps: readonly ConstructionStep[];
  visible: boolean;
  quantityScale?: number;
}

export const RecipeInstructions = memo(({
  steps,
  visible,
  quantityScale = 1,
}: RecipeInstructionsProps): ReactElement => {
  return (
    <ol className='recipe_instructions'>
      {steps.map((step, i) =>
        <Step
          key={i}
          step={step}
          visible={visible}
          quantityScale={quantityScale}
        />
      )}
    </ol>
  );
});

interface StepProps {
  step: ConstructionStep;
  visible: boolean;
  quantityScale: number;
}

const Step = ({ step, visible, quantityScale }: StepProps): ReactElement => {
  switch (step.type) {
    case 'start':
      return <StartStep step={step} quantityScale={quantityScale}/>;
    case 'end':
      return <EndStep step={step} quantityScale={quantityScale}/>;
    case 'mix':
      return <MixStep
        step={step}
        visible={visible}
        quantityScale={quantityScale}
      />;
    case 'add':
      return <AddStep step={step} quantityScale={quantityScale}/>;
    case 'addReagent':
      return <AddReagentStep step={step} quantityScale={quantityScale}/>;
    case 'heat':
      return <HeatStep step={step}/>;
    case 'heatMixture':
      return <HeatMixtureStep step={step}/>;
    case 'cut':
    case 'roll':
    case 'stir':
    case 'shake':
      return <SimpleStep step={step}/>;
    case 'spike':
      return <SpikeStep step={step}/>;
    case 'alsoMakes':
      return <AlsoMakesStep step={step} quantityScale={quantityScale}/>;
  }
};

interface ScaledStepProps {
  quantityScale: number;
}

interface StartStepProps extends ScaledStepProps {
  step: StartStep;
}

const StartStep = ({ step, quantityScale }: StartStepProps): ReactElement =>
  <li className='recipe_step recipe_step--compact'>
    Take <SolidIngredient
      id={step.entity}
      qty={quantityScale === 1 ? undefined : scaleAmount(1, quantityScale)}
    />
  </li>;

interface EndStepProps extends ScaledStepProps {
  step: EndStep;
}

const EndStep = ({ step, quantityScale }: EndStepProps): ReactElement => {
  const qty = quantityScale === 1
    ? undefined
    : scaleAmount(1, quantityScale);
  if (typeof step.entity === 'string') {
    return (
      <li className='recipe_step recipe_step--compact'>
        Finish with <SolidIngredient id={step.entity} qty={qty}/>
      </li>
    );
  } else {
    return (
      <li className='recipe_step recipe_step--add'>
        <span>Finish with one of:</span>
        {step.entity.map(id =>
          <SolidIngredient key={id} id={id} qty={qty}/>
        )}
      </li>
    );
  }
};

interface MixStepProps extends ScaledStepProps {
  step: MixStep;
  visible: boolean;
}

const MixStep = ({
  step,
  visible,
  quantityScale,
}: MixStepProps): ReactElement => {
  // Slightly more compact view if there's only one ingredient.
  // I really wish JS had a better way of traversing objects.
  const keys = Object.keys(step.reagents);
  if (keys.length === 1) {
    const id = keys[0];
    const ingredient = step.reagents[id];
    return (
      <li className='recipe_step recipe_step--compact'>
        {'Take '}
        <ReagentIngredient
          id={id}
          amount={ingredient.catalyst
            ? ingredient.amount
            : scaleAmount(ingredient.amount, quantityScale)}
          catalyst={ingredient.catalyst}
        />
      </li>
    );
  } else {
    return (
      <li className='recipe_step recipe_step--mix'>
        <div>Mix:</div>
        <RecipeIngredients
          visible={visible}
          reagents={step.reagents}
          solids={{}}
          quantityScale={quantityScale}
        />
      </li>
    );
  }
};

interface AddStepProps extends ScaledStepProps {
  step: AddStep;
}

const AddStep = ({ step, quantityScale }: AddStepProps): ReactElement => {
  let text: string;
  const implicitQty = !step.minCount && !step.maxCount && quantityScale !== 1
    ? scaleAmount(1, quantityScale)
    : undefined;
  if (step.minCount) {
    if (step.maxCount) {
      text = `Add ${scaleAmount(step.minCount, quantityScale)} to ${
        scaleAmount(step.maxCount, quantityScale)
      } `;
    } else {
      text = `Add ${scaleAmount(step.minCount, quantityScale)} or more`;
    }
  } else if (step.maxCount) {
    text = `Add up to ${scaleAmount(step.maxCount, quantityScale)} `;
  } else {
    text = `Add `;
  }

  // More compact appearance if only one entity matches
  if (typeof step.entity === 'string') {
    return (
      <li className='recipe_step recipe_step--compact'>
        {text} <SolidIngredient id={step.entity} qty={implicitQty}/>
      </li>
    );
  } else {
    if (step.minCount || step.maxCount) {
      text += ' of any of:';
    } else {
      text += ' any of:';
    }
    return (
      <li className='recipe_step recipe_step--add'>
        <span>{text}</span>
        {step.entity.map(id =>
          <SolidIngredient key={id} id={id} qty={implicitQty}/>
        )}
      </li>
    );
  }
};

interface AddReagentStepProps extends ScaledStepProps {
  step: AddReagentStep;
}

const AddReagentStep = ({
  step,
  quantityScale,
}: AddReagentStepProps): ReactElement => {
  const amount = step.minCount !== step.maxCount
    ? [
        scaleAmount(step.minCount, quantityScale),
        scaleAmount(step.maxCount, quantityScale),
      ] as const
    : scaleAmount(step.minCount, quantityScale);

  return (
    <li className='recipe_step recipe_step--compact'>
      Add <ReagentIngredient id={step.reagent} amount={amount}/>
    </li>
  );
};

interface HeatStepProps {
  step: HeatStep;
}

const HeatStep = ({ step }: HeatStepProps): ReactElement => {
  const { methodSprites } = useGameData();
  return (
    <li className='recipe_step recipe_step--simple'>
      <RawSprite position={methodSprites.heat!} alt=''/>
      Heat it to <Temperature k={step.minTemp}/>
    </li>
  );
};

interface HeatMixtureStepProps {
  step: HeatMixtureStep;
}

const HeatMixtureStep = ({ step }: HeatMixtureStepProps): ReactElement => {
  const { methodSprites } = useGameData();
  return (
    <li className='recipe_step recipe_step--simple'>
      <RawSprite position={methodSprites.heatMixture!} alt=''/>
      {' '}
      {step.maxTemp != null ? <>
        Heat it to between <Temperature k={step.minTemp}/> and <Temperature k={step.maxTemp}/>
      </> : <>
        Heat it to <Temperature k={step.minTemp}/>
      </>}
    </li>
  );
};

interface SimpleStepProps {
  step: SimpleInteractionStep;
}

const SimpleStep = ({ step }: SimpleStepProps): ReactElement => {
  const { methodSprites } = useGameData();
  return (
    <li className='recipe_step recipe_step--simple'>
      <RawSprite position={methodSprites[step.type]!} alt=''/>
      {SimpleStepText[step.type]}
    </li>
  );
};

const SimpleStepText: Readonly<Record<SimpleInteractionStep['type'], string>> = {
  cut: 'Cut it',
  roll: 'Roll it',
  shake: 'Shake it',
  stir: 'Stir it',
};

interface SpikeStepProps {
  step: SpikeStep;
}

// No sprite: spiking isn't a cooking method, so there's no method entity (and
// therefore no sprite) to show for it.
const SpikeStep = ({ step }: SpikeStepProps): ReactElement =>
  <li className='recipe_step recipe_step--compact'>
    {step.verb === 'crack'
      ? 'Crack it into a container'
      : 'Empty it into a container'}
  </li>;

interface AlsoMakesStepProps extends ScaledStepProps {
  step: AlsoMakesStep;
}

const AlsoMakesStep = ({
  step,
  quantityScale,
}: AlsoMakesStepProps): ReactElement => {
  const qty = quantityScale === 1
    ? undefined
    : scaleAmount(1, quantityScale);
  // More compact appearance if there's only one other entity
  if (typeof step.entity === 'string') {
    return (
      <li className='recipe_step recipe_step--compact recipe_step--also'>
        Also makes <SolidIngredient id={step.entity} qty={qty}/>
      </li>
    );
  } else {
    return (
      <li className='recipe_step recipe_step--add recipe_step--also'>
        <span>Also makes:</span>
        {step.entity.map(id =>
          <SolidIngredient key={id} id={id} qty={qty}/>
        )}
      </li>
    );
  }
};
