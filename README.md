# Concentration Notifier

This is a module for `dnd5e` helping Dungeon Masters and players track concentration.
At its core, a chat message will notify all active clients when an actor starts concentrating on an item or loses concentration on an item.

* An active effect is created on the actor when they use an item that has the `Concentration` component (for spells), and for other items a field has been supplied next to the `Duration` for non-spell items that should require concentration.
* An actor who is concentrating on something and takes damage will receive a message with two buttons; one for rolling a saving throw to maintain concentration, and one button for convenience to remove the concentration effect (the deletion button will prompt the user; the prompt can be skipped by holding Shift).
* The message also has a link to the item and shows the DC for the saving throw (standard calculation of half the damage taken, rounded down, to a minimum of 10).
* The active effect used to track concentration is named after the item, e.g., 'Bless' or 'Concentration - Bless'. The format can be toggled in the settings.
* If an actor who is already concentrating on an item uses a different item that requires concentration (or the same item but at a different level for spells), the active effect will get swapped. The effects otherwise have a duration equal to the item's duration, as set in the details of the item.

## Character Flags

The module supplies new fields (found under Special Traits). These fields work with Active Effects.
* `flags.dnd5e.concentrationAbility`: Change the ability that is used for the actor's concentration saves. For example, use Wisdom instead of Constitution by putting `wis` in this field.
* `flags.dnd5e.concentrationAdvantage`: Set the default of concentration saves to be rolled with advantage.
* `flags.dnd5e.concentrationBonus`: Give an actor a bonus to Concentration saves, such as `@abilities.int.mod` or `1d6`. Good for  Wizard Bladesingers. This field respects roll data.
* `flags.dnd5e.concentrationReliable`: change concentration saves such that rolls on the d20s cannot go below 10.

## Helper Functions

The Actor document is supplied with the new function `Actor#rollConcentrationSave`, which accepts the usual arguments (same as `rollAbilitySave`) but makes use of the above flags automatically.

Additionally, these functions are found in the global namespace `CN` (here `caster` refers to a token placeable, token document, or an actor document):
* `CN.isActorConcentrating(caster)`: returns the effect if the actor is concentrating on any item, otherwise `false`.
* `CN.isActorConcentratingOnItem(caster, item)`: returns the effect if the actor is concentrating on the given item, otherwise `false`.
* `CN.isEffectConcentration(effect)`: returns `true` or `false` if the effect is a concentration effect.
* `CN.breakConcentration(caster)`: ends all concentration effects on the actor. Returns the array of deleted effects.
* `CN.waitForConcentrationStart(caster, {item, max_wait=10000}={})`: will wait for the actor to receive any concentration effect (or specific to the item, if provided). Useful for halting scripts in edge cases. The optional integer denotes the maximum number of ms to wait for. Returns the effect if one exists, otherwise `false`.
* `CN.promptConcentrationSave(caster, {saveDC=10, message}={})`: displays a message for the actor like when they would have taken damage, using the DC provided (default 10). The message can be overridden. Returns the chat message created.
* `CN.redisplayCard(caster)`: displays the chat card of the item being concentrated on, at the level it was cast.

## Effect Flags

The effect placed on an actor to denote concentration contains some useful data, intended to make script writing easier for persistently active spells such as <em>call lightning</em> or <em>moonbeam</em>:
* `flags.concentrationnotifier.data.itemData`, with all the details of the item being concentrated on.
* `flags.concentrationnotifier.data.castData`, with the item's base level, the level at which it was cast, and its uuid.
