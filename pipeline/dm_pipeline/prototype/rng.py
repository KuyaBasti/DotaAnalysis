"""The single seeded RNG for the prototype sim.

Every stochastic draw in the simulation must go through one of these — nothing
else may call into randomness. That discipline is what makes a run reproducible
from its seed, and it's the same rule the Rust engine will enforce harder later
(see engine/sim-core/src/rng.rs in the file tree).

Python's random.Random (Mersenne Twister) is deterministic across runs and
platforms for a given seed, which is all the prototype needs.
"""

from __future__ import annotations

import random
from collections.abc import Sequence
from typing import TypeVar

T = TypeVar("T")


class SeededRng:
    def __init__(self, seed: int) -> None:
        self.seed = seed
        self._r = random.Random(seed)

    def uniform(self, lo: float, hi: float) -> float:
        """A float in [lo, hi)."""
        return self._r.uniform(lo, hi)

    def chance(self, p: float) -> bool:
        """True with probability p."""
        return self._r.random() < p

    def randint(self, lo: int, hi: int) -> int:
        """An int in [lo, hi] (inclusive)."""
        return self._r.randint(lo, hi)

    def sample(self, population: Sequence[T], k: int) -> list[T]:
        """k distinct items drawn from population (order randomized)."""
        return self._r.sample(list(population), k)
