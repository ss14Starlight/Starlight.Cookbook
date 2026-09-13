import { readFileSync } from 'node:fs';
import { EntityMap, EntityPrototype } from './prototypes';

/**
 * Any prototype that participates in prototype inheritance. Entities and
 * reagents both do; the traversal rules are identical for each.
 */
export interface InheritablePrototype {
  readonly id: string;
  readonly parent?: string | readonly string[];
}

/**
 * Synchronously reads a file as a string, assuming its contents are UTF-8,
 * and strips the BOM (byte-order mark) if present.
 */
export const readFileTextWithoutTheStupidBOM = (path: string): string => {
  const text = readFileSync(path, 'utf-8');
  return text.replace(/^\uFEFF/, '');
};

export const entityAndAncestors = (
  entity: EntityPrototype,
  allEntities: EntityMap
): Generator<EntityPrototype, void, undefined> =>
  prototypeAndAncestors(entity, allEntities, 'Entity');

export function* prototypeAndAncestors<
  K extends string,
  T extends InheritablePrototype
>(
  proto: T,
  all: ReadonlyMap<K, T>,
  kind: string
): Generator<T, void, undefined> {
  // Traverse the prototype's ancestors *first*, so the prototype can override
  // properties later.
  for (const parentId of parents(proto)) {
    // Prototype IDs are branded strings; `parent` is plain YAML text.
    const parent = all.get(parentId as K);
    if (!parent) {
      console.warn(`${kind} '${proto.id}' has unknown parent '${parentId}'`);
      continue;
    }
    yield* prototypeAndAncestors(parent, all, kind);
  }

  yield proto;
}

function* parents(
  proto: InheritablePrototype
): Generator<string, void, undefined> {
  const { parent } = proto;
  if (typeof parent === 'string') {
    yield parent;
  } else if (Array.isArray(parent)) {
    // The game processes parents from right to left. That is, the leftmost
    // parent takes precedence over the rightmost.
    for (let i = parent.length - 1; i >= 0; i--) {
      yield parent[i];
    }
  }
  // Otherwise, nothing
}

/**
 * Fields that are never inherited from a parent prototype: they identify the
 * prototype itself rather than describing it. In particular, `abstract` must
 * not leak downwards, or every child of an abstract base would vanish.
 */
const NonInheritedFields = new Set(['id', 'type', 'parent', 'abstract']);

/**
 * Flattens each prototype in `all` over its ancestor chain, so that consumers
 * can read a field directly instead of walking parents themselves.
 *
 * Entities get this treatment via `resolve-components.ts`, but reagents were
 * previously used raw. That silently broke any field declared on a base
 * prototype -- e.g. `group: Drinks` lives on `BaseDrink`, so `IceCream`
 * (IceCream -> BaseSoda -> BaseDrink) appeared to have no group at all, and
 * the reaction that produces it was discarded as non-food-related.
 */
export const flattenInheritance = <
  K extends string,
  T extends InheritablePrototype
>(
  all: ReadonlyMap<K, T>,
  kind: string
): Map<K, T> => {
  const result = new Map<K, T>();
  for (const [id, proto] of all) {
    const flattened: Record<string, unknown> = {};
    for (const ancestor of prototypeAndAncestors(proto, all, kind)) {
      for (const [key, value] of Object.entries(ancestor)) {
        // Ancestors come first, so a nearer prototype overwrites a further one.
        // `undefined` is treated as "not specified" rather than as a value.
        if (!NonInheritedFields.has(key) && value !== undefined) {
          flattened[key] = value;
        }
      }
    }
    // The prototype's own identity fields always win.
    result.set(id, { ...flattened, ...proto } as T);
  }
  return result;
};

export interface MapToObjectFn {
  <K extends string, V>(map: ReadonlyMap<K, V>): Record<K, V>;
  <K extends string, V, W>(
    map: ReadonlyMap<K, V>,
    mapValue: (value: V, key: K) => W
  ): Record<K, W>;
}

export const mapToObject = (<K extends string, V, W = V>(
  map: ReadonlyMap<K, V>,
  mapValue?: (value: V, key: K) => W
): Record<K, W> => {
  if (!mapValue) {
    // If mapValue is absent, then V = W, so we can do this.
    mapValue = ((v: V) => v) as unknown as (value: V) => W;
  }

  const result: Record<K, W> = {} as Record<K, W>;
  for (const [key, value] of map) {
    result[key] = mapValue(value, key);
  }
  return result;
}) as MapToObjectFn;
