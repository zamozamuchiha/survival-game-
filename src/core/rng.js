export function makeRng(seed = 1337) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rand.range = (min, max) => min + rand() * (max - min);
  rand.int = (min, max) => Math.floor(rand.range(min, max + 1));
  rand.pick = (arr) => arr[Math.floor(rand() * arr.length)];
  rand.chance = (p) => rand() < p;
  return rand;
}
