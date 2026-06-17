"""Timeline event types emitted by the prototype sim.

These mirror, in miniature, the timeline-event contract the real engine and
frontend will share (schemas/timeline-event.schema.json). Keeping events as
plain, JSON-serializable records is what lets us byte-compare two runs for
determinism and, later, render a match in the viewer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class EventType(str, Enum):
    GAME_START = "game_start"
    DRAFT_PRIOR = "draft_prior"
    ECONOMY = "economy"
    LANING = "laning"
    FIGHT = "fight"
    GAME_OVER = "game_over"


@dataclass
class Event:
    t: int  # game time in seconds
    type: EventType
    payload: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"t": self.t, "type": self.type.value, "payload": self.payload}
