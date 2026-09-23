# Cuepix rig patch chart

QLC+ stores addresses zero-based internally. Table shows fixture-display DMX addresses.

| Fixture | Model | Art-Net universe | Start | End | Channels |
|---|---|---:|---:|---:|---:|
| Cuepix 1 | CUEPIX Panel | 0 | 1 | 79 | 79 |
| Cuepix 2 | CUEPIX Panel | 0 | 80 | 158 | 79 |
| Cuepix 3 | CUEPIX Panel | 0 | 159 | 237 | 79 |
| Cuepix 4 | CUEPIX Panel | 0 | 238 | 316 | 79 |
| Beam L | Intimidator Beam 140SR V2 | 0 | 317 | 330 | 14 |
| Beam R | Intimidator Beam 140SR V2 | 0 | 331 | 344 | 14 |
| 375ZX L | Intimidator Spot 375ZX | 0 | 345 | 359 | 15 |
| 375ZX R | Intimidator Spot 375ZX | 0 | 360 | 374 | 15 |

CR011R DMX output handles Universe 0 only: Beam L at 317 → Beam R at 331 → 375ZX L at 345 → 375ZX R at 360. The panels take Universe 0 directly by Art-Net.
