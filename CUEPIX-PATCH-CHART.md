# Cuepix rig patch chart

QLC+ stores addresses zero-based internally. Table shows fixture-display DMX addresses.

| Fixture | Model | Art-Net universe | Start | End | Channels |
|---|---|---:|---:|---:|---:|
| Cuepix 1 | CUEPIX Panel | 0 | 1 | 79 | 79 |
| Cuepix 2 | CUEPIX Panel | 0 | 80 | 158 | 79 |
| Cuepix 3 | CUEPIX Panel | 0 | 159 | 237 | 79 |
| Cuepix 4 | CUEPIX Panel | 0 | 238 | 316 | 79 |
| Cuepix 5 | CUEPIX Panel | 1 | 1 | 79 | 79 |
| Cuepix 6 | CUEPIX Panel | 1 | 80 | 158 | 79 |
| Cuepix 7 | CUEPIX Panel | 1 | 159 | 237 | 79 |
| Cuepix 8 | CUEPIX Panel | 1 | 238 | 316 | 79 |
| Beam L | Intimidator Beam 140SR V2 | 0 | 317 | 330 | 14 |
| Beam R | Intimidator Beam 140SR V2 | 0 | 331 | 344 | 14 |
| 375ZX L | Intimidator Spot 375ZX | 0 | 345 | 359 | 15 |
| 375ZX R | Intimidator Spot 375ZX | 0 | 360 | 374 | 15 |

CR011R DMX output handles Universe 0 only: Beam L at 317 → Beam R at 331 → 375ZX L at 345 → 375ZX R at 360. Universe 1 goes directly by Art-Net to the panels listed above.
