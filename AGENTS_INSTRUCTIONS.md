# Instructions for AI Coding Agent: SessionZero Multi-System TRPG Engine

You are an expert Frontend Developer building "SessionZero", a universal AI TRPG Web App supporting both CoC 7th Edition and D&D 5e systems with a strict, non-hallucinating GM engine.

## 1. Primary Technology Architecture
- **Framework**: React + Vite 8
- **AI Agent Connectivity**: `@kaoruisaac/pedelec` (Pedelec Protocol)
- **UI Components**: Tailwind CSS + Shadcn/ui
- **State Management**: Zustand (with Snapshot & History State Machine)
- **Math Engine**: `mathjs`

## 2. Pedelec BYO-AI Integration Rules (Strict @kaoruisaac/pedelec Compliance)
1. Import SDK from `@kaoruisaac/pedelec` (e.g. `import { Pedelec, defineTool } from "@kaoruisaac/pedelec"`).
2. Integration Level is "Required Integration": Verify `pedelec.getApprovalStatus()` and `pedelec.listProviders()` before enabling gameplay UI.
3. Define tools using `defineTool` with `argsSchema` (JSON-compatible schema objects with `type: "object"`). Do NOT use Zod directly inside `defineTool`.
4. Register tools inside `pedelec.createSession({ skills: { tools: [...] } })`.

## 3. Strict GM Behavioral Directives (CRITICAL)
Enforce these prompt rules in system instructions given to the LLM:
- **Rule 1: No God-Moding**: The AI MUST NEVER narrate or decide the Player Character's (PC) actions, thoughts, or speech. Narration must pause as soon as player action is required.
- **Rule 2: Strict Outcome Permanence**: When a dice check fails or fumbles, the AI must deliver real negative consequences. Do NOT save the player artificially.
- **Rule 3: Information Barrier**: Never reveal `hidden_full_script` truth unless unlocked via successful skill checks.
- **Rule 4: Mandatory Tool Execution**: Any change in HP, SAN, or Inventory MUST trigger `update_game_stats`. Never change stats only in text.
- **Rule 5: House Rules Compliance**: User-defined House Rules in the `[HOUSE RULES]` context ALWAYS override standard SRD rules. Use `lookup_rule` tool to provide transparent rule justifications.

## 4. 3-Tier Memory Architecture & Context Injection
Assemble every message sent to Pedelec Session in this structure:
1. **Top System Directives & Hidden Truth**: Unchanging system persona and script secrets.
2. **Middle Layer (House Rules, Chapter Summaries & Lorebook Keys)**: Custom House Rules, compressed past events (if turn > 10) plus keyword-triggered SRD/World Info.
3. **Sliding Window**: Last 8-10 raw dialogue rounds.
4. **Bottom Injection (SSOT Context)**: Appended at the VERY END of the prompt:
   ```text
   [CURRENT SSOT GAME STATE]
   - System: {system_id} | Location: {location}
   - Active House Rules: [{house_rules_summary}]
   - Player Stats: HP={hp}/{max_hp}, SAN={san}/{max_san}, AC={ac}
   - Inventory: [{inventory}] | Active Clues: [{clues}] | Madness: {madness_status}
   ```

## 5. The 11 Universal Pedelec Tools

Implement the 11 tools using `defineTool` from `@kaoruisaac/pedelec` and connect handlers directly to Zustand actions:

1. `setup_script`: Initializes game system_id ('COC_7E' | 'DND_5E'), public summary, & hidden truth.
2. `generate_character_schema`: Generates system-specific character rules & skill pools.
3. `narrate_story`: Emits narrative & requests player-visible dice check (supports 1d100 and 1d20 with Advantage/Disadvantage).
4. `secret_check_request`: Performs silent background dice check for GM secret rolls without showing numbers to the player.
5. `update_game_stats`: Modifies HP/SAN/MP/SpellSlots/Inventory.
6. `mark_skill_success`: Flags successfully used skills for post-game growth.
7. `record_clue`: Adds discovered clues or quests to the Notebook tab.
8. `trigger_madness`: Triggers insanity/condition overlay.
9. `register_npc`: Updates NPC roster status & relationships.
10. `end_game_session`: Triggers ending UI & reveals hidden script truth.
11. `lookup_rule`: Cites SRD or House Rules justification for complex rule evaluations.

## 6. UI Guidelines

* Follow Pedelec component design guidelines for Status Badge and Installation Guideline UI components.
* Dynamic themes: Dark Lovecraftian for CoC 7e, Classic Fantasy Parchment for D&D 5e.
* Main Layout:
  * Left Sidebar: Character Sheet, Stats Bars, Inventory, Clue Notebook, NPC Roster.
  * Center: Story Log, Universal Dice Modal, Secret Roll Notice, Quick Action Presets, Input Area with Undo/Regenerate buttons.
  * Header: Pedelec Status Badge (`<PedelecStatusBadge/>`).
