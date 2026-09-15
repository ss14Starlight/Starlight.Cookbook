import { Jimp, JimpInstance, cssColorToHex } from 'jimp';
import { existsSync, readFileSync } from 'node:fs';
import { join as joinPath, resolve } from 'node:path';
import {
  CookingMethod,
  ReagentSourceMethod,
  SpriteAttribution,
  SpritePoint,
} from '../types';
import { ColorWhite } from './constants';
import { readFileTextWithoutTheStupidBOM } from './helpers';
import { ResolvedGameData } from './resolve-prototypes';
import { ParsedColor, ResolvedEntity } from './types';

export interface SpriteSheetData {
  /** Informative. */
  readonly spriteCount: number;
  readonly sheet: JimpInstance;
  readonly points: ReadonlyMap<string, SpritePoint>;
  readonly reagentPoints: ReadonlyMap<string, SpritePoint>;
  readonly methods: ReadonlyMap<
    CookingMethod | ReagentSourceMethod,
    SpritePoint
  >;
  readonly beakerFillPoint: SpritePoint;
  /** Frontier */
  readonly microwaveRecipeTypes?: ReadonlyMap<string, SpritePoint>;
  readonly attributions: readonly SpriteAttribution[];
}

export type SpriteOffsets = Map<string, SpritePoint>;

interface SpriteCollection {
  readonly spritesByKey: Map<string, DrawableSprite>;
  readonly entityToSpriteKey: Map<string, string>;
  readonly reagentToSpriteKey: Map<string, string>;
  readonly beakerFillKey: string;
}

interface DrawableSprite {
  readonly offset: SpritePoint;
  readonly layers: readonly DrawableLayer[];
}

interface DrawableLayer {
  readonly path: string;
  readonly state: string;
  readonly color: ParsedColor;
}

// Temporary type used while building attributions
type AttributionData = Omit<SpriteAttribution, 'sprites'> & {
  sprites: Map<string, SpritePoint>;
};

// All item sprites are 32x32 throughout the game
const SpriteSize = 32;
const SheetWidth = 24; // sprites across

const ZeroOffset: SpritePoint = [0, 0];

const DefaultMetamorphicGlass = {
  path: 'Objects/Consumable/Drinks/glass_clear.rsi',
  state: 'icon',
  maxFillLevels: 9,
  fillBaseName: 'fill-',
  changeColor: true,
  overlayState: 'icon-front',
} as const;

export const buildSpriteSheet = async (
  resolved: ResolvedGameData,
  textureDir: string,
  mixFillState: string,
  spriteOffsets: SpriteOffsets
): Promise<SpriteSheetData> => {
  const {
    spritesByKey,
    entityToSpriteKey,
    reagentToSpriteKey,
    beakerFillKey,
  } = collectSprites(resolved, mixFillState, spriteOffsets);
  const spriteCount = spritesByKey.size;

  const width = SpriteSize * SheetWidth;
  const height = SpriteSize * Math.ceil(spriteCount / SheetWidth);
  const sheet = new Jimp({ width, height });

  const spriteCache = new SpriteCache(textureDir);

  // Mapping from sprite key to its corresponding location in the sprite
  const spritePoints = new Map<string, SpritePoint>();

  let i = 0;
  for (const [key, sprite] of spritesByKey) {
    const point = placeSprite(i);
    await drawSprite(sheet, point, sprite, spriteCache);
    spritePoints.set(key, point);
    i++;
  }

  const entityPoints = new Map(
    Array.from(resolved.entities.keys(), id =>
      [id, spritePoints.get(entityToSpriteKey.get(id)!)!] as const
    )
  );

  const reagentPoints = new Map(
    Array.from(reagentToSpriteKey, ([id, key]) =>
      [id, spritePoints.get(key)!] as const
    )
  );

  const methods = new Map<CookingMethod | ReagentSourceMethod, SpritePoint>(
    Array.from(resolved.methodEntities, ([method, { id }]) =>
      [method, spritePoints.get(entityToSpriteKey.get(id)!)!] as const
    )
  );

  let microwaveRecipeTypes: Map<string, SpritePoint> | undefined;
  if (resolved.microwaveRecipeTypeEntities) {
    microwaveRecipeTypes = new Map<string, SpritePoint>(
      Array.from(resolved.microwaveRecipeTypeEntities, ([subtype, { id }]) =>
        [subtype, spritePoints.get(entityToSpriteKey.get(id)!)!] as const
      )
    );
  }

  return {
    spriteCount,
    sheet,
    points: entityPoints,
    reagentPoints,
    methods,
    beakerFillPoint: spritePoints.get(beakerFillKey)!,
    microwaveRecipeTypes,
    attributions: spriteCache.getAttributions(),
  };
};

const collectSprites = (
  resolved: ResolvedGameData,
  mixFillState: string,
  spriteOffsets: SpriteOffsets
): SpriteCollection => {
  // Mapping from sprite key to sprite data.
  const spritesByKey = new Map<string, DrawableSprite>();
  // Maps an entity to its corresponding sprite key.
  // Translated later to a sprite point.
  const entityToSpriteKey = new Map<string, string>();
  const reagentToSpriteKey = new Map<string, string>();

  for (const entity of resolved.entities.values()) {
    tryCollectSprite(entity, spritesByKey, entityToSpriteKey, spriteOffsets);
  }

  for (const [id, reagent] of resolved.reagents) {
    const metamorphic = reagent.metamorphicSprite ?? (
      reagent.group === 'Drinks' ? DefaultMetamorphicGlass : undefined
    );
    if (!metamorphic) {
      continue;
    }

    const layers: DrawableLayer[] = [{
      path: metamorphic.path,
      state: metamorphic.state,
      color: ColorWhite,
    }];
    if (metamorphic.maxFillLevels > 0 && metamorphic.fillBaseName) {
      layers.push({
        path: metamorphic.path,
        state: `${metamorphic.fillBaseName}${metamorphic.maxFillLevels}`,
        color: metamorphic.changeColor
          ? cssColorToHex(reagent.color)
          : ColorWhite,
      });
    }
    if (metamorphic.overlayState) {
      layers.push({
        path: metamorphic.path,
        state: metamorphic.overlayState,
        color: ColorWhite,
      });
    }

    const sprite: DrawableSprite = { offset: ZeroOffset, layers };
    const key = drawableSpriteKey(sprite);
    spritesByKey.set(key, sprite);
    reagentToSpriteKey.set(id, key);
  }

  for (const entity of resolved.methodEntities.values()) {
    tryCollectSprite(entity, spritesByKey, entityToSpriteKey, spriteOffsets);
  }

  if (resolved.microwaveRecipeTypeEntities) {
    for (const entity of resolved.microwaveRecipeTypeEntities.values()) {
      tryCollectSprite(entity, spritesByKey, entityToSpriteKey, spriteOffsets);
    }
  }

  // The beaker fill insert needs some special code, for funsies.
  const beakerLargeEnt = resolved.methodEntities.get('mix')!;
  const beakerLargeSpriteKey = entityToSpriteKey.get(beakerLargeEnt.id)!;
  const beakerLargeSprite = spritesByKey.get(beakerLargeSpriteKey)!;

  const beakerFillSprite: DrawableSprite = {
    offset: beakerLargeSprite.offset,
    layers: [{
      path: beakerLargeSprite.layers[0].path,
      state: mixFillState,
      color: ColorWhite,
    }],
  };
  const beakerFillKey = drawableSpriteKey(beakerFillSprite);
  spritesByKey.set(beakerFillKey, beakerFillSprite);

  return {
    spritesByKey,
    entityToSpriteKey,
    reagentToSpriteKey,
    beakerFillKey,
  };
};

const tryCollectSprite = (
  entity: ResolvedEntity,
  spritesByKey: Map<string, DrawableSprite>,
  entityToSpriteKey: Map<string, string>,
  spriteOffsets: SpriteOffsets
): void => {
  if (entityToSpriteKey.has(entity.id)) {
    return;
  }

  const sprite = toDrawableSprite(entity, spriteOffsets);
  const key = drawableSpriteKey(sprite);

  // This may overwrite an existing sprite if multiple entities share sprites,
  // but that's okay as the sprite data is identical. If the data differed,
  // the key would too.
  spritesByKey.set(key, sprite);
  entityToSpriteKey.set(entity.id, key);
};

const toDrawableSprite = (
  entity: ResolvedEntity,
  spriteOffsets: SpriteOffsets
): DrawableSprite => {
  const { sprite } = entity;
  const basePath = sprite.path;
  const baseColor = sprite.color
    ? cssColorToHex(sprite.color)
    : ColorWhite;

  if (sprite.icon) {
    return {
      offset: spriteOffsets.get(entity.id) ?? ZeroOffset,
      layers: [{
        path: sprite.icon.path,
        state: sprite.icon.state,
        color: ColorWhite,
      }],
    };
  }

  const layers: DrawableLayer[] = [];

  for (let i = 0; i < sprite.layers.length; i++) {
    const layer = sprite.layers[i];
    // Don't warn about missing state: this sometimes happens when a layer uses
    // `map` to assign a state later at some point. A null state is fine in that
    // case, and we just skip the layer altogether.
    if (!layer.visible || !layer.state) {
      continue;
    }
    // If it has a state but no path, however, that's an issue.
    const path = layer.path ?? basePath;
    if (!path) {
      console.warn(`Entity '${entity.id}': sprite layer ${i} has no RSI path`);
      continue;
    }
    const color = layer.color
      ? cssColorToHex(layer.color)
      : ColorWhite;

    layers.push({
      path,
      state: layer.state,
      color: multiplyColors(baseColor, color),
    });
  }

  // The component's bare `state` is a *fallback*, not an extra bottom layer.
  // The engine only promotes it to a layer when `layers` is empty (see
  // SpriteComponent.Initialize in RobustToolbox), so drawing it underneath a
  // populated layer list is wrong: an entity that inherits `state` from a
  // parent and then declares its own `layers` never renders that state, and it
  // may not even exist in the child's RSI (e.g. FoodFeastFestiveDinner, which
  // inherits `state: box` from BoxCardboard but draws from turkey.rsi).
  //
  // We also fall back to it when every layer was skipped above, which happens
  // when layers start `visible: false` and are switched on at runtime by a
  // visualizer we can't run (e.g. StackVisuals on FoodBakedPancake).
  if (layers.length === 0 && sprite.state && basePath) {
    layers.push({
      color: baseColor,
      path: basePath,
      state: sprite.state,
    });
  }

  if (layers.length === 0) {
    throw new Error(`Entity '${entity.id}': no layers to render`);
  }

  return {
    offset: spriteOffsets.get(entity.id) ?? ZeroOffset,
    layers,
  };
};

const drawableSpriteKey = (sprite: DrawableSprite): string =>
  // Super sloppy and lazy. But it works okay.
  JSON.stringify(sprite);

const placeSprite = (index: number): SpritePoint =>
  [
    SpriteSize * (index % SheetWidth),
    SpriteSize * Math.floor(index / SheetWidth),
  ];

const drawSprite = async (
  sheet: JimpInstance,
  point: SpritePoint,
  sprite: DrawableSprite,
  spriteCache: SpriteCache
): Promise<void> => {
  const x = point[0] + sprite.offset[0];
  const y = point[1] + sprite.offset[1];
  for (const layer of sprite.layers) {
    let sprite = await spriteCache.read(
      layer.path,
      layer.state,
      point
    );

    if (layer.color !== ColorWhite) {
      sprite = sprite.clone();
      modulateByColor(sprite, layer.color);
    }

    sheet.blit({
      x,
      y,
      src: sprite,
      srcX: 0,
      srcY: 0,
      srcW: SpriteSize,
      srcH: SpriteSize,
    });
  }
};

const modulateByColor = (image: JimpInstance, color: ParsedColor): void => {
  const r = (color >>> 24) & 0xFF;
  const g = (color >>> 16) & 0xFF;
  const b = (color >>> 8) & 0xFF;

  const bitmap = image.bitmap.data;
  for (let i = 0; i < bitmap.length; i += 4) {
    bitmap[i] = Math.floor((bitmap[i] * r) / 255);
    bitmap[i + 1] = Math.floor((bitmap[i + 1] * g) / 255);
    bitmap[i + 2] = Math.floor((bitmap[i + 2] * b) / 255);
  }
};

const multiplyColors = (
  color1: ParsedColor,
  color2: ParsedColor
): ParsedColor => {
  if (color1 === ColorWhite) {
    return color2;
  }
  if (color2 === ColorWhite) {
    return color1;
  }

  const r1 = (color1 >>> 24) & 0xFF;
  const r2 = (color2 >>> 24) & 0xFF;

  const g1 = (color1 >>> 16) & 0xFF;
  const g2 = (color2 >>> 16) & 0xFF;

  const b1 = (color1 >>> 8) & 0xFF;
  const b2 = (color2 >>> 8) & 0xFF;

  const a1 = color1 & 0xFF;
  const a2 = color2 & 0xFF;

  // Outside of `>>>`, JS does not have unsigned bit operations. If the red
  // value overflows into the sign bit, we'll end up with a negative number.
  // However, we can fudge it by shifting the entire result with `>>> 0`, which
  // will force JS to interpret the whole thing as an unsigned 32-bit integer.
  // This is mental.
  return (
    (Math.floor((r1 * r2) / 255) << 24) |
    (Math.floor((g1 * g2) / 255) << 16) |
    (Math.floor((b1 * b2) / 255) << 8) |
    (Math.floor((a1 * a2) / 255))
  ) >>> 0;
};

class SpriteCache {
  private readonly dir: string;
  private readonly data = new Map<string, JimpInstance>();
  private readonly attributions = new Map<string, AttributionData>();

  public constructor(dir: string) {
    this.dir = dir;
  }

  public async read(
    path: string,
    state: string,
    point: SpritePoint
  ): Promise<JimpInstance> {
    const key = joinPath(path, `${state}.png`);

    const attribution = this.loadAttributions(path);
    attribution.sprites.set(point.toString(), point);

    let image = this.data.get(key);
    if (!image) {
      const fullPath = resolve(this.dir, key);

      if (existsSync(fullPath)) {
        try {
          image = await this.tryReadPng(fullPath);
        } catch (e) {
          throw new Error(`Error reading ${fullPath}: ${e}`, { cause: e });
        }
      } else {
        console.error(
          `Unable to resolve sprite path for state '${
            state
          }' in '${
            path
          }'`
        );
        // Return an empty image...
        image = new Jimp({ width: SpriteSize, height: SpriteSize });
      }

      this.data.set(key, image);
    }

    return image;
  }

  private async tryReadPng(fullPath: string): Promise<JimpInstance> {
    // This whole code is stupid.
    //
    // Unfortunately, for WHATEVER REASON, PNGs in SS14 often end with random
    // bullshit data at the end of the stream. Jimp's PNG parser rejects this
    // invalid trailing data, while the game just shrugs and throws it away.
    // Since sneaky trailing data makes its way into the game with astonishing
    // regularity and is never caught by anyone in any kind of review, we've
    // fudged the PNG reading a bit here.
    //
    // Basically: If the PNG reader throws an error with the exact message
    // "unrecognised content at end of stream", walk the PNG chunks and trim
    // everything after the real IEND chunk before trying again.
    const MagicErrorMessage = 'unrecognised content at end of stream';

    const buffer = readFileSync(fullPath);
    try {
      return await Jimp.fromBuffer(buffer) as JimpInstance;
    } catch (e) {
      if (!(e instanceof Error) || e.message !== MagicErrorMessage) {
        throw e;
      }

      const trimmed = trimPngAfterIend(buffer);
      if (trimmed.length === buffer.length) {
        throw e;
      }

      console.log(
        `${fullPath}: trimming buffer (${buffer.length - trimmed.length} B)`
      );
      return await Jimp.fromBuffer(trimmed) as JimpInstance;
    }
  }

  public getAttributions(): readonly SpriteAttribution[] {
    const collator = new Intl.Collator('en-US', {
      caseFirst: 'false',
      ignorePunctuation: false,
    });
    return Array.from(
      this.attributions.values(),
      attr => ({
        ...attr,
        sprites: Array.from(attr.sprites.values()),
      })
    ).sort((a, b) => collator.compare(a.path, b.path));
  }

  private loadAttributions(path: string): AttributionData {
    let attribution = this.attributions.get(path);

    if (!attribution) {
      const metaPath = resolve(this.dir, joinPath(path, 'meta.json'));
      const metaRaw = readFileTextWithoutTheStupidBOM(metaPath);
      let meta: any;
      try {
        meta = JSON.parse(metaRaw);
      } catch (e) {
        meta = {
          license: '(invalid sprite metadata)',
          copyright: '(invalid sprite metadata)',
        };
        console.error(`${metaPath}: Error parsing attributions:`, e);
      }

      let copyright = typeof meta.copyright === 'string'
        ? meta.copyright
        : '';
      if (meta.extra_copyright && Array.isArray(meta.extra_copyright)) {
        if (copyright) {
          copyright += '\n';
        }
        copyright += meta.extra_copyright.join('\n');
      }

      attribution = {
        path,
        license: typeof meta.license === 'string' ? meta.license : '',
        copyright,
        sprites: new Map<string, SpritePoint>(),
      };
      this.attributions.set(path, attribution);
    }
    return attribution;
  }
}

const trimPngAfterIend = (buffer: Buffer): Buffer => {
  // Eight-byte PNG signature, then length/type/data/CRC chunks.
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const dataLength = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunkEnd = offset + 12 + dataLength;
    if (chunkEnd > buffer.length) {
      return buffer;
    }
    if (type === 'IEND') {
      return buffer.subarray(0, chunkEnd);
    }
    offset = chunkEnd;
  }
  return buffer;
};
