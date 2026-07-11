# convex

Convex functions — owned by Tab A.

Standard Convex layout at the repo root. Schema, event ingestion mutations, per-view
queries, replay cursor, run-diff query, memory tables, and steering live here.

`schema.ts` is authored by the contract agent and is READ-ONLY for tabs — it is part of
the frozen contract. Changes only via the architect session.
