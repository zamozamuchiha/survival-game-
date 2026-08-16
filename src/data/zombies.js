// Zombie roster. `speed` is m/s while chasing, `atkCd` seconds between hits.

export const ZOMBIE_TYPES = {
  walker: {
    name: 'Walker', hp: 42, dmg: 10, speed: 2.5, wanderSpeed: 0.9,
    aggro: 14, lose: 24, atkCd: 1.3, xp: 12, scale: 1,
    flesh: 0x5d7a4e, rag: 0x3d3a33,
  },
  runner: {
    name: 'Runner', hp: 30, dmg: 8, speed: 5.4, wanderSpeed: 1.6,
    aggro: 19, lose: 30, atkCd: 0.85, xp: 22, scale: 0.95,
    flesh: 0x7d6a45, rag: 0x53372f,
  },
  dog: {
    name: 'Feral Dog', hp: 24, dmg: 7, speed: 6.6, wanderSpeed: 2.2,
    aggro: 21, lose: 32, atkCd: 0.75, xp: 18, scale: 0.8, quad: true,
    flesh: 0x4a3d31, rag: 0x3a3028,
  },
  toxic: {
    name: 'Toxic', hp: 56, dmg: 8, speed: 2.9, wanderSpeed: 1.0,
    aggro: 16, lose: 26, atkCd: 1.4, xp: 34, scale: 1.05, poison: 9,
    flesh: 0x6f8f4a, rag: 0x44502e,
  },
  brute: {
    name: 'Brute', hp: 165, dmg: 26, speed: 2.1, wanderSpeed: 0.7,
    aggro: 13, lose: 22, atkCd: 2.1, xp: 70, scale: 1.5, knock: 2.4,
    flesh: 0x6b5340, rag: 0x3a2f28,
  },
};
