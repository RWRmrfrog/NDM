import { system, world, BlockTypes, EntityComponentTypes, EquipmentSlot, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const modelOptions = [
  "Cube"
]

const FACE_OFFSET = {
  up: { x: 0.5, y: 1.05, z: 0.5 },
  down: { x: 0.5, y: -0.05, z: 0.5 },
  north: { x: 0.5, y: 0.5, z: -0.05 },
  south: { x: 0.5, y: 0.5, z: 1.05 },
  east: { x: 1.05, y: 0.5, z: 0.5 },
  west: { x: -0.05, y: 0.5, z: 0.5 }
};

const FACE_YAW = {
  north: 180,
  south: 0,
  east: 270,
  west: 90,
  up: 0,
  down: 0
};

const FACE_MOUNT_TYPE = {
  up: "floor",
  down: "ceiling",
  north: "wall",
  south: "wall",
  east: "wall",
  west: "wall"
};

let framePlace = false;

system.beforeEvents.startup.subscribe((initEvent) => {
  initEvent.itemComponentRegistry.registerCustomComponent("ndm:place_frame", {
    onUseOn(event) {
      const player = event.source;
      const block = event.block;
      const face = String(event.blockFace).toLowerCase();
      const itemName = event.itemStack?.nameTag;

      framePlace = true;

      const offset = FACE_OFFSET[face];
      const mountType = FACE_MOUNT_TYPE[face];
      if (!offset || !mountType) {
        console.warn(`[Decorative Frame] Unrecognized blockFace value: "${event.blockFace}"`);
        return;
      }

      const yaw = FACE_YAW[face];

      const loc = block.location;
      const spawnLocation = {
        x: loc.x + offset.x,
        y: loc.y + offset.y,
        z: loc.z + offset.z
      };

      const entities = player.dimension.getEntities({
        location: spawnLocation,
        maxDistance: 0.05
      });

      const occupied = entities.some(e => {
        if (e.typeId !== "ndm:decorative_frame") return false;
        const dx = Math.abs(e.location.x - spawnLocation.x);
        const dy = Math.abs(e.location.y - spawnLocation.y);
        const dz = Math.abs(e.location.z - spawnLocation.z);
        return dx < 0.05 && dy < 0.05 && dz < 0.05;
      });

      if (occupied) return;

      system.run(() => {
        const mountEvent = `ndm:mount_${mountType}`;

        // Needed to replace " and / characters in the nameTag to avoid command issues
        const nameTag = itemName ? ` "${itemName.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : "";

        player.dimension.runCommand(
          `summon ndm:decorative_frame ${spawnLocation.x} ${spawnLocation.y} ${spawnLocation.z} ${yaw} 0 ${mountEvent} ${nameTag}`
        );

        block.dimension.playSound("block.itemframe.place", block.location);

        if (player.getGameMode() !== "Creative") {
          const equippable = player.getComponent(EntityComponentTypes.Equippable);
          const item = equippable?.getEquipment(EquipmentSlot.Mainhand);
          if (item) {
            if (item.amount > 1) {
              item.amount -= 1;
              equippable.setEquipment(EquipmentSlot.Mainhand, item);
            } else {
              equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
            }
          }
        }
      });
    }
  });
});

world.afterEvents.itemUse.subscribe((event) => {
  const { itemStack, source } = event;
  if (!itemStack) return;
  if (itemStack.typeId !== "ndm:decorative_frame") return;
  if (source.typeId !== "minecraft:player" || !source.isSneaking) return;

  if (framePlace == true) {
    framePlace = false;
    return;
  }

  const selectedSlotIndex = source.selectedSlotIndex;
  const inventory = source.getComponent("minecraft:inventory");
  const newItemStack = itemStack.clone();

  const form = new ActionFormData().title("Select Model");

  for (const model of modelOptions) {
    form.button(model);
  }

  form.show(source).then((response) => {
    if (response.canceled) return;

    const chosenModel = modelOptions[response.selection];

    newItemStack.nameTag = chosenModel;
    inventory.container.setItem(selectedSlotIndex, newItemStack);
  });
});

// MOVEMENT FORM

const MAX_ROTATION_STEPS = 8;

function showMoveMenu(player, target) {
  const form = new ActionFormData()
    .title("ndm:decorative_frame_properties")
    .button("-X")
    .button("+X")
    .button("+Z")
    .button("-Z")
    .button("+Y")
    .button("-Y")
    .button("+S")
    .button("-S");

  form.show(player).then((response) => {
    if (response.canceled) return;

    const pos = target.location;
    const moveAmount = 0.0625;
    const basePixels = 4;   
    const minPixels = 4;
    const maxPixels = 16;

    let newPos = { x: pos.x, y: pos.y, z: pos.z };

    switch (response.selection) {
      case 0: newPos.x -= moveAmount; target.teleport(newPos); break;
      case 1: newPos.x += moveAmount; target.teleport(newPos); break;
      case 2: newPos.z += moveAmount; target.teleport(newPos); break;
      case 3: newPos.z -= moveAmount; target.teleport(newPos); break;
      case 4: newPos.y += moveAmount; target.teleport(newPos); break;
      case 5: newPos.y -= moveAmount; target.teleport(newPos); break;
      case 6: {
        const current = target.getProperty("ndm:scale") ?? 1.0;
        const currentPixels = Math.round(current * basePixels);
        const nextPixels = Math.min(maxPixels, currentPixels + 1);
        const next = nextPixels / basePixels;
        target.setProperty("ndm:scale", next);
        break;
      }
      case 7: {
        const current = target.getProperty("ndm:scale") ?? 1.0;
        const currentPixels = Math.round(current * basePixels);
        const nextPixels = Math.max(minPixels, currentPixels - 1);
        const next = nextPixels / basePixels;
        target.setProperty("ndm:scale", next);
        break;
      }
    }

    showMoveMenu(player, target);
  });
}

// ITEM ROTATION AND DROPPING

let justGaveItem = false;

world.afterEvents.dataDrivenEntityTrigger.subscribe((event) => {
  if (event.entity.typeId !== "ndm:decorative_frame") return;
  if (event.eventId !== "ndm:holding_item") return;
  justGaveItem = true;
});

world.afterEvents.playerInteractWithEntity.subscribe((event) => {
  const { target, player } = event;

  if (target.typeId !== "ndm:decorative_frame") return;

  if (justGaveItem) {
    justGaveItem = false;
    return;
  }

  if (player.isSneaking) {
    showMoveMenu(player, target);
  } else {
    if ((target.getProperty("ndm:has_item") == true && !(target.nameTag)) || target.nameTag) {
      system.run(() => {
        const current = target.getProperty("ndm:rotation") ?? 0;
        const next = (current + 1) % MAX_ROTATION_STEPS;
        target.setProperty("ndm:rotation", next);
        target.dimension.playSound("block.itemframe.rotate_item", target.location);
      });
    }
  }
});

world.afterEvents.entityHitEntity.subscribe((event) => {
  const { hitEntity } = event;
  if (hitEntity.typeId !== "ndm:decorative_frame") return;

  // Grab everything before triggering drop_item
  const location = hitEntity.location;
  const rotation = hitEntity.getRotation();
  const nameTag = hitEntity.nameTag;
  const mountType = hitEntity.getProperty("ndm:mount_type");
  const hasItem = hitEntity.getProperty("ndm:has_item") == true;

  if (hasItem) {
    system.run(() => {
      const oldId = hitEntity.id;
      hitEntity.triggerEvent("ndm:drop_item");
      hitEntity.dimension.playSound("block.itemframe.remove_item", location);

      const nameArg = nameTag ? ` "${nameTag.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : "";
      const mountEvent = mountType ? `ndm:mount_${mountType}` : "";

      hitEntity.dimension.runCommand(`summon ndm:decorative_frame ${location.x} ${location.y} ${location.z} ${rotation.y} ${rotation.x} ${mountEvent}${nameArg}`);

      const candidates = hitEntity.dimension.getEntities({type: "ndm:decorative_frame", location, maxDistance: 0.05});

      candidates.find(e => e.id !== oldId);
    });
  } else {
    system.run(() => {
      hitEntity.triggerEvent("ndm:drop_item");
      const item = new ItemStack("ndm:decorative_frame", 1);
      if (nameTag) item.nameTag = nameTag;
      hitEntity.dimension.spawnItem(item, location);
      hitEntity.dimension.playSound("block.itemframe.break", location);
    });
  }
});