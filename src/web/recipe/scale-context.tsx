import {
  ReactElement,
  ReactNode,
  createContext,
  useContext,
  useState,
} from 'react';

const RecipeScaleContext = createContext(1);

export interface RecipeScaleProviderProps {
  children: ReactNode;
}

export const RecipeScaleProvider = ({
  children,
}: RecipeScaleProviderProps): ReactElement => {
  const [input, setInput] = useState('1');
  const parsedScale = Number(input);
  const scale = Number.isFinite(parsedScale) && parsedScale > 0
    ? parsedScale
    : 1;

  return (
    <RecipeScaleContext value={scale}>
      {children}
      <label className='recipe-scale'>
        <span>Recipes ×</span>
        <input
          type='number'
          min='0.001'
          step='any'
          inputMode='decimal'
          aria-label='Recipe quantity multiplier'
          value={input}
          onChange={e => setInput(e.currentTarget.value)}
          onBlur={() => {
            if (!Number.isFinite(parsedScale) || parsedScale <= 0) {
              setInput('1');
            }
          }}
        />
      </label>
    </RecipeScaleContext>
  );
};

export const useRecipeScale = (): number => useContext(RecipeScaleContext);
