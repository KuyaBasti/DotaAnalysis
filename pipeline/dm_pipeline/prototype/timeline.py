"""An ordered log of simulation events.

The timeline IS the sim's output: a replayable, inspectable record. Determinism
tests compare two timelines byte-for-byte; the viewer will later render one.
"""

from __future__ import annotations

from typing import Any

from dm_pipeline.prototype.events import Event


class Timeline:
    def __init__(self) -> None:
        self.events: list[Event] = []

    def emit(self, event: Event) -> None:
        self.events.append(event)

    def to_list(self) -> list[dict[str, Any]]:
        return [event.to_dict() for event in self.events]
