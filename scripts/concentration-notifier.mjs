import { CONSTS } from "./const.mjs";

export class CN {
	// determine if you are concentrating on a specific item.
	static actor_is_concentrating_on_item = (actor, item) => {
		const caster = actor.actor ? actor.actor : actor;
		return caster.effects.find(i => i.getFlag(CONSTS.MODULE.NAME, "castingData.itemUuid") === item.uuid);
	}
	
	// determine if you are concentrating on ANY item.
	static actor_is_concentrating_on_anything = (actor) => {
		const caster = actor.actor ? actor.actor : actor;
		return caster.effects.find(i => CN.effect_is_concentration_effect(i));
	}
	
	// determine if effect is concentration effect.
	static effect_is_concentration_effect = (effect) => {
		return effect.getFlag("core", "statusId") === CONSTS.MODULE.CONC;
	}
	
	// end all concentration effects on an actor.
	static end_concentration_on_actor = async (actor) => {
		const caster = actor.actor ? actor.actor : actor;
		const effects = caster.effects.filter(i => CN.effect_is_concentration_effect(i));
		if(effects.length > 0){
			const deleteIds = effects.map(i => i.id);
			return caster.deleteEmbeddedDocuments("ActiveEffect", deleteIds);
		}
		return [];
	}
	
	// end concentration on single item.
	static end_concentration_on_item = async (actor, item) => {
		const caster = actor.actor ? actor.actor : actor;
		const effect = CN.actor_is_concentrating_on_item(actor, item);
		if(!!effect) return effect.delete();
		else return ui.notifications.warn(game.i18n.localize("CN.WARN.MISSING_CONC_ON_ITEM"));
	}
	
	// wait for concentration on item to be applied on actor.
	static wait_for_concentration_to_begin_on_item = async (actor, item, max_wait = 10000) => {
		async function wait(ms){return new Promise(resolve => {setTimeout(resolve, ms)})}
		
		let conc = CN.actor_is_concentrating_on_item(actor, item);
		let waited = 0;
		while(!conc && waited < max_wait){
			await wait(100);
			waited = waited + 100;
			console.log(waited);
			conc = CN.actor_is_concentrating_on_item(actor, item);
		}
		if(!!conc) return conc;
		return false;
	}
	
	// apply concentration when using a specific item.
	static start_concentration_on_item = async (item, castingData = {}, messageData = {}, actorData = {})  => {
		
		// get the caster.
		let caster = item.parent;
		
		// if this is a temporary item, actorId or actorUuid must be provided in actorData.
		if(!caster) caster = actorData.actorUuid ? await fromUuid(actorData.actorUuid) : undefined;
		
		// bail out if caster is still undefined.
		if(!caster) return;
		
		// get whether the caster is already concentrating.
		const concentrating = CN.actor_is_concentrating_on_anything(caster);
		
		// create effect data.
		const effectData = await CN._createEffectData(item, castingData, messageData, actorData);
		
		// get some needed properties for the following cases.
		const castLevel = getProperty(effectData, `flags.${CONSTS.MODULE.NAME}.castingData.castLevel`);
		const itemId = getProperty(effectData, `flags.${CONSTS.MODULE.NAME}.castingData.itemId`);
		
		// case 1: not concentrating.
		if(!concentrating){
			return caster.createEmbeddedDocuments("ActiveEffect", [effectData]);
		}
		
		// case 2: concentrating on a different item.
		if(concentrating.getFlag(CONSTS.MODULE.NAME, "castingData.itemId") !== itemId){
			await CN.end_concentration_on_actor(caster);
			return caster.createEmbeddedDocuments("ActiveEffect", [effectData]);
		}
		
		// case 3: concentrating on the same item but at a different level.
		if(concentrating.getFlag(CONSTS.MODULE.NAME, "castingData.castLevel") !== castLevel){
			await CN.end_concentration_on_actor(caster);
			return caster.createEmbeddedDocuments("ActiveEffect", [effectData]);
		}
		
		// case 4: concentrating on the same item at the same level.
		return [];
	};
	
	// method to request a save for concentration.
	static request_saving_throw = async (caster, dc = 10, options = {}) => {
		if(!caster) return ui.notifications.warn(game.i18n.localize("CN.WARN.MISSING_ACTOR"));
		
		// get actor from token.
		const actor = caster.actor ? caster.actor : caster;
		
		// find a concentration effect.
		const effect = CN.actor_is_concentrating_on_anything(actor);
		if(!effect) return ui.notifications.error(game.i18n.localize("CN.WARN.MISSING_CONC"));
		
		// get the name of the item being concentrated on.
		const itemName = effect.getFlag(CONSTS.MODULE.NAME, "name");
		
		// build the message.
		const {abilityShort, abilityLong} = CN._getConcentrationAbility(actor);
		const name = game.i18n.localize("CN.NAME.CARD_NAME");
		
		// start constructing the message.
		const messageData = {};
		
		// flags needed for message button listeners.
		messageData[`flags.${CONSTS.MODULE.NAME}.effectUuid`] = effect.uuid;
		messageData[`flags.${CONSTS.MODULE.NAME}.actorUuid`] = actor.uuid;
		messageData[`flags.${CONSTS.MODULE.NAME}.saveDC`] = dc;
		messageData[`flags.core.canPopOut`] = true;
		
		// icon of the effect, used in the chat message.
		const moduleImage = effect.data.icon;
		
		// the description in the chat message.
		const cardContent = options.cardContent ?? "";
		
		// the full contents of the chat message.
		const saveLabel = game.i18n.format("CN.LABEL.SAVING_THROW", {dc, ability: abilityLong});
		const deleteLabel = game.i18n.localize("CN.LABEL.DELETE_CONC");
		
		messageData["content"] = `
			<div class="dnd5e chat-card">
			<header class="card-header flexrow">
				<img src="${moduleImage}" title="${name}" width="36" height="36"/>
				<h3 class="item-name">${name}</h3>
			</header>
			<div class="card-content"> ${cardContent} </div>
			<div class="card-buttons">
				<button id="${CONSTS.BUTTON_ID.SAVE}">${saveLabel}</button>
				<button id="${CONSTS.BUTTON_ID.DELETE}">${deleteLabel}</button>
			</div>`;
		
		// get array of users with Owner permission of the actor.
		const whisper = Object.entries(actor.data.permission).filter(([id, perm]) => {
			if(!game.users.get(id)) return false;
			if(perm !== CONST.DOCUMENT_PERMISSION_LEVELS.OWNER) return false;
			return true;
		}).map(([id, perm]) => id);
		messageData["whisper"] = whisper;
		
		// get array of users with Owner permission of the actor who are not GMs.
		const playerOwners = whisper.filter(i => !game.users.get(i)?.isGM);
		
		// creator of the message is the PLAYER owner doing the damage, if they exist, otherwise the first player owner, otherwise the one doing the update, otherwise the current user.
		messageData["user"] = (playerOwners.length > 0) ? (playerOwners.includes(options.userId) ? options.userId : playerOwners[0]) : options.userId ? options.userId : game.user.id;
		
		// set message speaker alias.
		messageData["speaker.alias"] = game.i18n.localize("CN.MESSAGE.SPEAKER");
		
		// create message.
		return ChatMessage.create(messageData);
	};
	
	// create the data for the new concentration effect.
	static _createEffectData = async (item, castingData = {}, messageData = {}, actorData = {}) => {
		
		// get the caster.
		let caster = item.parent;
		
		// if this is a temporary item, actorId or actorUuid must be provided in actorData.
		if(!caster) caster = actorData.actorUuid ? await fromUuid(actorData.actorUuid) : undefined;
		
		// bail out if caster is still undefined.
		if(!caster) return ui.notifications.warn("Caster was somehow undefined.");
		
		// create embedded details for the effect to save for later and other functions.
		const flags = {
			core: {statusId: CONSTS.MODULE.CONC},
			convenientDescription: game.i18n.format("CN.CONVENIENT_DESCRIPTION", {name: item.name}),
			[CONSTS.MODULE.NAME]: {
				actorData: {actorId: caster.id, actorUuid: caster.uuid},
				itemData: !!item.toObject ? item.toObject() : item,
				castingData: mergeObject(castingData, {
					itemId: item.id,
					itemUuid: item.uuid,
					baseLevel: getProperty(item, "data.data.level") ?? getProperty(item, "data.level")
				}),
				messageData
			}
		}
		
		// get duration for the effect.
		const itemDuration = getProperty(item, "data.data.duration") ?? getProperty(item, "data.duration") ?? {};
		const duration = CN._getItemDuration(itemDuration);
		
		// get icon for the effect.
		const icon = CN._getModuleImage(item);
		
		// get origin for the effect. If the item is temporary, use actor uuid.
		const origin = item.uuid ?? caster.uuid;
		
		// get effect label, depending on settings.
		const prepend = game.settings.get(CONSTS.MODULE.NAME, CONSTS.SETTINGS.PREPEND_EFFECT_LABELS);
		const label = prepend ? `${game.i18n.localize("CN.NAME.CARD_NAME")} - ${item.name}` : item.name;
		
		// return constructed effect data.
		return {icon, label, origin, duration, flags}
	};
	
	// get the ability the actor uses for concentration saves.
	static _getConcentrationAbility = (actor = null) => {
		// get the game's abilities.
		const abilities = CONFIG.DND5E.abilities;
		
		// get the actor's ability in flags, or default to constitution.
		const concentrationAbility = actor?.getFlag("dnd5e", CONSTS.FLAG.CONCENTRATION_ABILITY) ?? "con";
		
		// assure that the flag is a valid ability, else default to constitution.
		const abilityShort = Object.keys(abilities).includes(concentrationAbility) ? concentrationAbility : "con";
		
		// get the full name of the ability.
		const abilityLong = abilities[abilityShort];
		
		// return the names.
		return {abilityShort, abilityLong};
	};
	
	// the function executed when clicking the DELETE button for concentration effects.
	static _onClickDeleteButton = (_chatLog, html) => {
		html[0].addEventListener("click", async (event) => {
			
			// get the target of the mouse click.
			const button = event.target;
			
			// bail out if it is not the 'removeeffect' button.
			if(event.target.id !== CONSTS.BUTTON_ID.DELETE) return;
			
			// get the chat card of the button.
			const card = button.closest(".chat-card");
			
			// get the id of the chat card.
			const messageId = card.closest(".message").dataset.messageId;
			
			// get the message itself.
			const message = game.messages.get(messageId);
			
			// get the uuid of the effect to delete.
			const effectUuid = message.getFlag(CONSTS.MODULE.NAME, "effectUuid") ?? false;
			
			// bail out if the effect uuid could not be found for some reason.
			if(!effectUuid) return;
			
			// get the actual effect.
			const effect = await fromUuid(effectUuid);
			
			// bail out if the effect could not be found for some reason.
			if(!effect) return;
			
			// reset the button, it should never be disabled unless something is missing.
			button.removeAttribute("disabled");
			
			// if shift key, skip the dialog and just delete the effect.
			if(event.shiftKey) return effect.delete();
			
			// create the dialog to prompt for deletion of the effect.
			const itemName = effect.getFlag(CONSTS.MODULE.NAME, "name");
			return Dialog.confirm({
				title: game.i18n.format("CN.DELETE_DIALOG_TITLE", {name: itemName}),
				content: `
					<h4>${game.i18n.localize("AreYouSure")}</h4>
					<p>${game.i18n.format("CN.DELETE_DIALOG_TEXT", {name: itemName})}</p>`,
				yes: effect.delete.bind(effect),
				options: {}
			});
		});
	};
	
	// the function executed when clicking the SAVING THROW button for concentration effects.
	static _onClickSaveButton = (_chatLog, html) => {
		html[0].addEventListener("click", async (event) => {
			
			// get the target of the mouse click.
			const button = event.target;
			
			// bail out if it is not the 'concentrationsave' button.
			if(event.target.id !== CONSTS.BUTTON_ID.SAVE) return;
			
			// get the chat card of the button.
			const card = button.closest(".chat-card");
			
			// get the id of the chat card.
			const messageId = card.closest(".message").dataset.messageId;
			
			// get the message itself.
			const message = game.messages.get(messageId);
			
			// get the actor uuid.
			const actorUuid = message.getFlag(CONSTS.MODULE.NAME, "actorUuid") ?? false;
			
			// bail out if the uuid could not be found.
			if(!actorUuid) return;
			
			// get the actor from the uuid.
			const uuidActor = await fromUuid(actorUuid);
			
			// if the actor is a token, use the token actor.
			const actor = uuidActor?.actor ? uuidActor.actor : uuidActor;
			
			// bail out if the actor could not be found.
			if(!actor) return;
			
			// create object of saving throw options.
			//const saveModifiers = {fumble: -1, critical: 21, event};
			const options = {}
			
			// get the DC of the saving throw.
			const saveDC = message.getFlag(CONSTS.MODULE.NAME, "saveDC") ?? false;
			//if(!!saveDC) saveModifiers.targetValue = saveDC;
			if(!!saveDC) options.targetValue = saveDC;
			
			// add any additional bonuses to the saving throw.
			//const concentrationBonus = actor.getFlag("dnd5e", CONSTS.FLAG.CONCENTRATION_BONUS) ?? false;
			//if(!!concentrationBonus) saveModifiers.parts = [concentrationBonus];
			
			// apply min10.
			//const concentrationReliable = !!actor.getFlag("dnd5e", CONSTS.FLAG.CONCENTRATION_RELIABLE);
			//if(concentrationReliable) saveModifiers.reliableTalent = true;
			
			// apply advantage if flag exists.
			//const concentrationAdvantage = !!actor.getFlag("dnd5e", CONSTS.FLAG.CONCENTRATION_ADVANTAGE);
			//if(concentrationAdvantage) saveModifiers.advantage = true;
			
			// get the shorthand key of the ability used for the save.
			//const {abilityShort} = CN._getConcentrationAbility(actor);
			
			// enable button again; it should never be off.
			button.removeAttribute("disabled");
			
			// roll the save.
			//return actor.rollAbilitySave(abilityShort, saveModifiers);
			//const initial_roll = await actor.rollAbilitySave(abilityShort, {...saveModifiers, chatMessage: false});
			
			// pass the saving throw through the min/max modifier.
			//return CN.min_max_roll_on_save(actor, initial_roll);
			
			return actor.rollConcentrationSave(options);
		});
	};
	
	// get the image used for the effect.
	static _getModuleImage = (item) => {
		// the custom icon in the settings.
		const moduleImage = game.settings.get(CONSTS.MODULE.NAME, CONSTS.SETTINGS.CONCENTRATION_ICON);
		
		// whether or not to use the item img instead.
		const useItemImage = game.settings.get(CONSTS.MODULE.NAME, CONSTS.SETTINGS.CONCENTRATION_ICON_ITEM);
		
		// Case 1: the item has an image, and it is prioritised.
		if(useItemImage && !!item?.img) return item.img;
		
		// Case 2: there is no custom image in the settings, so use the default image.
		if(!moduleImage) return CONSTS.MODULE.IMAGE;
		
		// Case 3: Use the custom image in the settings.
		return moduleImage;
	};
	
	// set up the duration of the effect depending on the item.
	static _getItemDuration = (duration) => {
		if(!duration?.value) return {};
		const {value, units} = duration;
		
		// do not bother for these duration types:
		if(["inst", "month", "perm", "spec", "year"].includes(units)) return {};
		
		// cases for the remaining units of time:
		if(units === "round") return {rounds: value};
		if(units === "turn") return {turns: value};
		if(units === "minute") return {seconds: value * 60};
		if(units === "hour") return {seconds: value * 60 * 60};
		if(units === "day") return {seconds: value * 24 * 60 * 60};
	};
	
	// the primary hook. Gets details of the message.
	static _getMessageDetails = (msg, msgData) => {
		
		// get the html of the message.
		const template = document.createElement("template");
		template.innerHTML = msgData.content;
		const html = template.content.firstChild;
		const isHTML = html instanceof HTMLElement;
		if(!isHTML) return;
		
		// get ids from chat message.
		const syntheticActorId = html.getAttribute("data-token-id") ?? false;
		const actorId = html.getAttribute("data-actor-id") ?? false;
		
		// set caster as token uuid if it exists, else use the actor id, but only if linked actor.
		let caster;
		if(syntheticActorId){
			const split = syntheticActorId.split(".");
			const tokenDoc = game.scenes.get(split[1])?.tokens.get(split[3]);
			caster = tokenDoc?.actor;
		}else if(game.actors.get(actorId)?.data?.token?.actorLink){
			caster = game.actors.get(actorId);
		}else return;
		
		// get item and spell level.
		const itemId = html.getAttribute("data-item-id");
		const castLevel = Number(html.getAttribute("data-spell-level"));
		const messageData = msg.toObject();
		
		// bail out if something could not be found.
		if(!caster || !itemId || isNaN(castLevel)) return;
		
		// get item data; if the item does not exist on the actor, use the embedded flag data.
		const itemActor = caster.items.get(itemId);
		const itemFlags = msg.getFlag("dnd5e", "itemData");
		const item = itemActor ? itemActor : itemFlags;
		
		// make sure it's a concentration spell.
		const is_concentration = !!getProperty(item, "data.data.components.concentration") || !!getProperty(item, "data.components.concentration");
		if(!is_concentration) return;
		
		// create castingData.
		const castingData = {itemId, castLevel};
		
		// create actorData.
		const actorData = {actorId, actorUuid: caster.uuid}
		
		// apply concentration.
		return CN.start_concentration_on_item(item, castingData, messageData, actorData);
	};
	
	// send a message when an actor LOSES concentration.
	static _messageConcLoss = (effect) => {
		// get whether the effect being deleted is a concentration effect.
		if(!CN.effect_is_concentration_effect(effect)) return;
		
		// build the chat message.
		const name = effect.getFlag(CONSTS.MODULE.NAME, "itemData.name");
		const description = effect.getFlag(CONSTS.MODULE.NAME, "itemData.data.description.value");
		const content = `
			<p>${game.i18n.format("CN.MESSAGE.CONC_LOSS", {name: effect.parent.name, item: name})}</p>
			<hr>
			<details>
				<summary>${game.i18n.localize("CN.MESSAGE.DETAILS")}</summary> <hr> ${description}
			</details> <hr>`;
		const speaker = {alias: CONSTS.MODULE.SPEAKER};
		const flags = {core: {canPopOut: true}};
		
		return ChatMessage.create({content, speaker, flags});
	};
	
	// send a message when an actor GAINS concentration.
	static _messageConcGain = (effect) => {
		// get whether the effect being created is a concentration effect.
		if(!CN.effect_is_concentration_effect(effect)) return;
		
		// build the chat message.
		const name = effect.getFlag(CONSTS.MODULE.NAME, "itemData.name");
		const description = effect.getFlag(CONSTS.MODULE.NAME, "itemData.data.description.value");
		const content = `
			<p>${game.i18n.format("CN.MESSAGE.CONC_GAIN", {name: effect.parent.name, item: name})}</p>
			<hr>
			<details>
				<summary>${game.i18n.localize("CN.MESSAGE.DETAILS")}</summary> <hr> ${description}
			</details> <hr>`;
		const speaker = {alias: CONSTS.MODULE.SPEAKER};
		const flags = {core: {canPopOut: true}};
		
		return ChatMessage.create({content, speaker, flags});
	};
	
	// store values for use in "updateActor" hook if HP has changed.
	static _storeOldValues = (actor, data, context) => {
		
		// get old values. These always exist, but temp is null when 0.
		const old_temp = getProperty(actor, "data.data.attributes.hp.temp") ?? 0;
		const old_value = getProperty(actor, "data.data.attributes.hp.value");
		
		// get new values. If they are undefined, there was no change to them, so we use old values.
		const new_temp = getProperty(data, "data.attributes.hp.temp") === undefined ? old_temp : (getProperty(data, "data.attributes.hp.temp") ?? 0);
		const new_value = getProperty(data, "data.attributes.hp.value") ?? old_value;
		
		// calculate health difference.
		const damageTaken = (old_temp + old_value) - (new_temp + new_value);
		
		// if damageTaken > 0, tag context for a saving throw.
		if(damageTaken > 0) context[CONSTS.MODULE.NAME] = {save: true, damage: damageTaken};
	};
	
	// if the user is concentrating, and has taken damage, build a chat card, and call for a saving throw.
	static _buildSavingThrowData = async (actor, data, context, userId) => {
		// only do this for the one doing the update.
		if(userId !== game.user.id) return;
		
		// bail out if there is no save needed.
		if(!getProperty(context, `${CONSTS.MODULE.NAME}.save`)) return;
		
		// get damage taken.
		const damageTaken = context[CONSTS.MODULE.NAME].damage;
		
		// find a concentration effect.
		const effect = CN.actor_is_concentrating_on_anything(actor);
		
		// bail out if actor is not concentrating.
		if(!effect) return;
		
		// get the name of the item being concentrated on.
		const name = effect.getFlag(CONSTS.MODULE.NAME, "itemData.name");
		
		// calculate DC from the damage taken.
		const dc = Math.max(10, Math.floor(Math.abs(damageTaken) / 2));
		
		// get the ability being used for concentration saves.
		const {abilityShort, abilityLong} = CN._getConcentrationAbility(actor);
		
		// the chat message contents.
		const cardContent = game.i18n.format("CN.MESSAGE.CONC_SAVE", {name: actor.name, damage: Math.abs(damageTaken), dc, ability: abilityLong, item: name});
		
		// pass to saving throw.
		return CN.request_saving_throw(actor, dc, {cardContent, userId});
	};
	
	// create the concentration flags on actor Special Traits.
	static _createActorFlags = () => {
		const section = game.i18n.localize("CN.NAME.CARD_NAME");
		const abilityScoreKeys = Object.keys(CONFIG.DND5E.abilities).map(i => `'${i}'`).join(", ");
		
		/* Add bonus on top of the saving throw. */
		CONFIG.DND5E.characterFlags[CONSTS.FLAG.CONCENTRATION_BONUS] = {
			name: game.i18n.localize("CN.CHARACTER_FLAGS.BONUS.NAME"),
			hint: game.i18n.localize("CN.CHARACTER_FLAGS.BONUS.HINT"),
			section,
			type: String
		};
		
		/* Change the ability being used for the saving throw. */
		CONFIG.DND5E.characterFlags[CONSTS.FLAG.CONCENTRATION_ABILITY] = {
			name: game.i18n.localize("CN.CHARACTER_FLAGS.ABILITY.NAME"),
			hint: game.i18n.format("CN.CHARACTER_FLAGS.ABILITY.HINT", {keys: abilityScoreKeys}),
			section,
			type: String
		};
		
		/* Set a flag for having advantage on Concentration saves. */
		CONFIG.DND5E.characterFlags[CONSTS.FLAG.CONCENTRATION_ADVANTAGE] = {
			name: game.i18n.localize("CN.CHARACTER_FLAGS.ADVANTAGE.NAME"),
			hint: game.i18n.localize("CN.CHARACTER_FLAGS.ADVANTAGE.HINT"),
			section,
			type: Boolean
		};
		
		/* Set a flag for not being able to roll below 10. */
		CONFIG.DND5E.characterFlags[CONSTS.FLAG.CONCENTRATION_RELIABLE] = {
			name: game.i18n.localize("CN.CHARACTER_FLAGS.RELIABLE.NAME"),
			hint: game.i18n.localize("CN.CHARACTER_FLAGS.RELIABLE.HINT"),
			section,
			type: Boolean
		};
		
		/* Set a number a character cannot roll below. */
		CONFIG.DND5E.characterFlags[CONSTS.FLAG.CONCENTRATION_FLOOR] = {
			name: game.i18n.localize("CN.CHARACTER_FLAGS.FLOOR.NAME"),
			hint: game.i18n.localize("CN.CHARACTER_FLAGS.FLOOR.HINT"),
			section,
			type: Number
		}
		
		/* Set a number a character cannot roll above. */
		CONFIG.DND5E.characterFlags[CONSTS.FLAG.CONCENTRATION_CEILING] = {
			name: game.i18n.localize("CN.CHARACTER_FLAGS.CEILING.NAME"),
			hint: game.i18n.localize("CN.CHARACTER_FLAGS.CEILING.HINT"),
			section,
			type: Number
		}
	};
	
	// apply min and max to the roll if they exist.
	static min_max_roll_on_save = async (actor, message) => {
		const msg = message;
		const floor = actor.getFlag("dnd5e", CONSTS.FLAG.CONCENTRATION_FLOOR) ?? 1;
		const ceil = actor.getFlag("dnd5e", CONSTS.FLAG.CONCENTRATION_CEILING) ?? 20;
		
		const useFloor = 20 >= floor && floor > 1;
		const useCeil = 20 > ceil && ceil > 0;
				
		if(useFloor) msg.dice[0].modifiers.push(`min${floor}`);
		if(useCeil) msg.dice[0].modifiers.push(`max${ceil}`);
		msg._formula = msg._formula.replace("d20", "d20" + (useFloor ? `min${floor}` : "") + (useCeil > 0 ? `max${ceil}` : ""));
		for(let d20 of msg.dice[0].results){
			if(useFloor && d20.result < floor){
				d20.rerolled = true;
				d20.count = floor;
			}
			if(useCeil && d20.result > ceil){
				d20.rerolled = true;
				d20.count = ceil;
			}
		}
		msg._total = (await new Roll(msg.result).evaluate({async: true})).total;
		const speaker = msg.speaker;
		return msg.toMessage({speaker});
	}
	
	// roll for concentration. This will be added to the Actor prototype.
	static roll_concentration_save = async function(options = {}){
		// create object of saving throw options.
		const saveModifiers = {fumble: -1, critical: 21, event};
		
		// get the DC of the saving throw.
		const targetValue = options.targetValue ?? false;
		if(!!targetValue) saveModifiers.targetValue = targetValue;
		
		// add any additional bonuses to the saving throw.
		const concentrationBonus = this.getFlag("dnd5e", CONSTS.FLAG.CONCENTRATION_BONUS) ?? false;
		if(!!concentrationBonus) saveModifiers.parts = [concentrationBonus];
		
		// apply min10.
		const concentrationReliable = !!this.getFlag("dnd5e", CONSTS.FLAG.CONCENTRATION_RELIABLE);
		if(concentrationReliable) saveModifiers.reliableTalent = true;
		
		// apply advantage if flag exists.
		const concentrationAdvantage = !!this.getFlag("dnd5e", CONSTS.FLAG.CONCENTRATION_ADVANTAGE);
		if(concentrationAdvantage) saveModifiers.advantage = true;
		
		// get the shorthand key of the ability used for the save.
		const {abilityShort} = CN._getConcentrationAbility(this);
		
		// roll the save.
		const initial_roll = await this.rollAbilitySave(abilityShort, {...saveModifiers, chatMessage: false});
		
		// pass the saving throw through the min/max modifier.
		return CN.min_max_roll_on_save(this, initial_roll, options);
	}
}

// button-click hooks:
Hooks.on("renderChatLog", CN._onClickDeleteButton);
Hooks.on("renderChatPopout", CN._onClickDeleteButton);
Hooks.on("renderChatLog", CN._onClickSaveButton);
Hooks.on("renderChatPopout", CN._onClickSaveButton);

// functionality hooks:
Hooks.on("preCreateChatMessage", CN._getMessageDetails);
Hooks.on("preUpdateActor", CN._storeOldValues);
Hooks.on("updateActor", CN._buildSavingThrowData);
Hooks.once("ready", CN._createActorFlags);

// gain and loss messages.
Hooks.on("preDeleteActiveEffect", CN._messageConcLoss);
Hooks.on("preCreateActiveEffect", CN._messageConcGain);
