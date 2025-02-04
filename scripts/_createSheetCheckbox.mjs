import { MODULE } from "./settings.mjs";

export function setHooks_createSheetCheckBox(){

    Hooks.on("renderItemSheet", async (sheet, html) => {
        const item = sheet.object;
        if ( item.type === "spell" ) return;
        const selector = "[name='system.duration.units']";
        const durationSelect = html[0].querySelector(selector);
        if ( !durationSelect ) return;
        const template = `modules/${MODULE}/templates/concentrationCheckbox.hbs`;
        const { requiresConcentration } = item.getFlag(MODULE, "data") ?? {};
        const innerHTML = await renderTemplate(template, {
            requiresConcentration
        });
        const div = document.createElement("DIV");
        div.innerHTML = innerHTML;
        durationSelect.after(...div.children);
    });
}
