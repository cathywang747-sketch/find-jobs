import { greenhouse } from "./greenhouse.mjs";
import { generic } from "./generic.mjs";
import { lever } from "./lever.mjs";

export const adapters = [greenhouse, lever];

export function detectAts(url) {
  const match = adapters.find((adapter) => adapter.matches(url));
  return match?.type ?? "generic";
}

export function adapterFor(url) {
  return adapters.find((adapter) => adapter.matches(url)) ?? generic;
}
