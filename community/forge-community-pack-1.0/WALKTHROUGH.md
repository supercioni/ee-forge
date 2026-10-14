# The Lantern Route — solution and authoring notes

Spoilers follow. All progression is available through normal station comms and combat.

1. Host the scenario with **Campaign = New**; select **LANTERN-1**.
2. Hail **PORT LANTERN** → **Read mission orders** → **Back to mission control**. This sets `briefed` to numeric `1`.
3. Select **Open corridor to Echo Reach**. The same player ship arrives at `echo_arrival`. The first-entry rule spawns the `raiders` group and orders it to stand its ground.
4. Close comms. Destroy **RAIDER-1** and **RAIDER-2** using the ship's weapons. `clear_raiders` detects the group is wiped out, sets `raiders_cleared = 1` and writes the next instruction to the log.
5. Hail **ECHO RELAY** → **Download the archive**. The reply is offered only when both raiders are gone and `archive = 0`. It sets `archive = 1` and requests a checkpoint.
6. Select **Return to Lantern Anchorage**. Close comms and hail **PORT LANTERN**.
7. Select **Deliver the recovered archive**. This sets `delivered = 1`; rule `win` writes the completion message and awards victory to **Human Navy**.

Station service replies hand over to EmptyEpsilon's stock services. To return to the mission conversation, close comms and hail again. Stock service availability and costs are governed by EE.

## How it is built

| Element | Where to inspect in Forge | Purpose |
| --- | --- | --- |
| `crew` (Shared) | Map | One player ship kept between sectors |
| `home`, `home_scenery` | Lantern Anchorage | Port and scenery |
| `relay`, `echo_scenery` | Echo Reach | Relay and scenery |
| `raiders` | Echo Reach; spawned by rule | Two stock enemy ships |
| `lantern_arrival`, `echo_arrival` | Map markers | Safe, explicit arrival points |
| `enter_echo` | Mission → Rules | One-time spawn and defensive orders |
| `clear_raiders` | Mission → Rules | Combat objective |
| `win`, `lose_*` | Mission → Rules | Explicit endings |
| `echo_reminder` | Mission → Timeline | Reminder after 90 active Echo seconds |
| `port_comms`, `relay_comms` | Dialogues | Briefing, travel, download and delivery |
| Four numeric variables | Mission → Variables | Visible mission progress |
| Campaign saves enabled | Mission → Campaign | Frozen sectors and checkpoint/resume |

Both sectors use overlapping coordinates on purpose. Select one sector in the editor to see it clearly; **All sectors** overlays them. Visibility is an editing convenience, not a gameplay condition.

## Safe experiments on a copy

- Change the briefing text and verify that only generated text changes.
- Move an asteroid in Echo Reach, save and export both targets.
- Add a third raider to the existing group: the group objective automatically covers it. Retest difficulty.
- Move the reminder from Echo scope to global scope and compare the timing when you leave Echo early.
- Add a new flag-controlled dialogue reply, then trace it through Variables and Rules.

Do not edit generated Lua as the main authoring workflow: the next export replaces it. Start a new campaign after structural changes; an old checkpoint may be incompatible. Do not turn sector unloading into a `Destroy group` action, which would count as genuine destruction.
